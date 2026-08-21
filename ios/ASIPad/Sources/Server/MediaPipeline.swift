import Foundation
import ImageIO
import CoreGraphics
import AVFoundation
import UniformTypeIdentifiers

/// iOS/macOS-native replacements for the Pi's Pillow + ffmpeg steps.
/// One deliberate divergence from app.py: normalized images are written as
/// JPEG instead of WebP (iOS has no system WebP *encoder*). The galleries
/// list by extension and .jpg is in ALLOWED_BG, so nothing downstream cares.
enum MediaPipeline {
    static let maxBGDim = CGSize(width: 1280, height: 720)  // display resolution
    static let jpegQuality: CGFloat = 0.80

    /// Port of `_normalize_bg`: decode, apply EXIF orientation, box-fit into
    /// 1280x720, re-encode. Keeps the kiosk's decoded RAM footprint bounded.
    static func normalizeImage(_ data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0 else { return nil }
        // kCGImageSourceCreateThumbnailWithTransform bakes in EXIF rotation
        // (Pillow's exif_transpose). Max pixel size bounds the longest edge;
        // the box fit below handles the 720 height cap.
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Int(max(maxBGDim.width, maxBGDim.height)),
        ]
        guard var image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return nil }

        let w = CGFloat(image.width), h = CGFloat(image.height)
        let scale = min(maxBGDim.width / w, maxBGDim.height / h, 1)
        if scale < 1 {
            let target = CGSize(width: (w * scale).rounded(.down), height: (h * scale).rounded(.down))
            if let scaled = redraw(image, size: target) { image = scaled }
        }
        return encodeJPEG(image, quality: jpegQuality)
    }

    /// Port of `_generate_gif_poster`: first frame, ≤640px, JPEG.
    static func gifPoster(_ data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0 else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 640,
        ]
        guard let frame = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return nil }
        return encodeJPEG(frame, quality: 0.82)
    }

    /// Port of `_generate_video_poster`: one frame near the start, 480px wide.
    /// Synchronous like the ffmpeg call it replaces; upload requests already
    /// run on the server queue.
    static func videoPoster(_ videoURL: URL) -> Data? {
        let asset = AVURLAsset(url: videoURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 480, height: 4096)  // width-bound, like scale=480:-2
        let time = CMTime(seconds: 0.5, preferredTimescale: 600)
        // Fall back to the very first frame for sub-half-second clips.
        generator.requestedTimeToleranceBefore = .positiveInfinity
        generator.requestedTimeToleranceAfter = .positiveInfinity
        guard let cgImage = try? generator.copyCGImage(at: time, actualTime: nil) else { return nil }
        return encodeJPEG(cgImage, quality: 0.75)
    }

    // MARK: - Helpers

    private static func redraw(_ image: CGImage, size: CGSize) -> CGImage? {
        let context = CGContext(data: nil,
                                width: Int(size.width), height: Int(size.height),
                                bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        guard let context = context else { return nil }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(origin: .zero, size: size))
        return context.makeImage()
    }

    private static func encodeJPEG(_ image: CGImage, quality: CGFloat) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }
}
