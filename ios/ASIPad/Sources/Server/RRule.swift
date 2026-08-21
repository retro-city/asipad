import Foundation

/// Just enough RFC-5545 RRULE evaluation to answer the one question the kiosk
/// asks: "does this event occur on day X?". Supports FREQ=DAILY/WEEKLY/
/// MONTHLY/YEARLY with INTERVAL, UNTIL, COUNT (daily/weekly), and BYDAY for
/// weekly rules. Anything it can't parse evaluates to "no occurrence" —
/// the same failure mode as app.py's catch-all around rrulestr().
enum RRule {
    private static let weekdayCodes = ["MO": 2, "TU": 3, "WE": 4, "TH": 5, "FR": 6, "SA": 7, "SU": 1]  // Calendar weekday numbers

    static var calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        return cal
    }()

    static func parseDate(_ iso: String) -> Date? {
        // "yyyy-MM-dd" (our events.json) or "yyyyMMdd" (inside UNTIL=).
        let digits = iso.filter(\.isNumber)
        guard digits.count >= 8,
              let y = Int(digits.prefix(4)),
              let m = Int(digits.dropFirst(4).prefix(2)),
              let d = Int(digits.dropFirst(6).prefix(2)) else { return nil }
        return calendar.date(from: DateComponents(year: y, month: m, day: d))
    }

    /// Port of app.py's `_event_occurs_on`.
    static func eventOccurs(event: [String: Any], on target: Date) -> Bool {
        guard let start = parseDate(event["dtstart"] as? String ?? "") else { return false }
        guard let rrule = event["rrule"] as? String, !rrule.isEmpty else {
            return calendar.isDate(start, inSameDayAs: target)
        }
        return occurs(rrule: rrule, dtstart: start, on: target)
    }

    static func occurs(rrule raw: String, dtstart: Date, on target: Date) -> Bool {
        guard target >= calendar.startOfDay(for: dtstart) else { return false }

        // "RRULE:FREQ=..." or bare "FREQ=..."
        var spec = raw.trimmingCharacters(in: .whitespaces)
        if let colon = spec.range(of: ":"), spec.uppercased().hasPrefix("RRULE:") {
            spec = String(spec[colon.upperBound...])
        }
        var parts: [String: String] = [:]
        for pair in spec.split(separator: ";") {
            let kv = pair.split(separator: "=", maxSplits: 1)
            guard kv.count == 2 else { continue }
            parts[kv[0].uppercased()] = String(kv[1]).uppercased()
        }
        guard let freq = parts["FREQ"] else { return false }
        let interval = max(1, Int(parts["INTERVAL"] ?? "1") ?? 1)

        if let until = parts["UNTIL"], let untilDate = parseDate(until),
           calendar.startOfDay(for: target) > calendar.startOfDay(for: untilDate) {
            return false
        }

        let startDay = calendar.startOfDay(for: dtstart)
        let targetDay = calendar.startOfDay(for: target)
        let days = calendar.dateComponents([.day], from: startDay, to: targetDay).day ?? 0
        let count = Int(parts["COUNT"] ?? "") ?? Int.max

        switch freq {
        case "DAILY":
            guard days % interval == 0 else { return false }
            return days / interval < count
        case "WEEKLY":
            if let byday = parts["BYDAY"], !byday.isEmpty {
                // COUNT with BYDAY needs full expansion — unsupported, ignore COUNT.
                let wanted = byday.split(separator: ",").compactMap { weekdayCodes[String($0)] }
                guard wanted.contains(calendar.component(.weekday, from: targetDay)) else { return false }
                let weeks = weeksBetween(startDay, targetDay)
                return weeks % interval == 0
            }
            guard calendar.component(.weekday, from: targetDay) == calendar.component(.weekday, from: startDay)
            else { return false }
            guard days % (7 * interval) == 0 else { return false }
            return days / (7 * interval) < count
        case "MONTHLY":
            guard calendar.component(.day, from: targetDay) == calendar.component(.day, from: startDay)
            else { return false }
            let months = calendar.dateComponents([.month], from: startDay, to: targetDay).month ?? 0
            return months % interval == 0
        case "YEARLY":
            guard calendar.component(.day, from: targetDay) == calendar.component(.day, from: startDay),
                  calendar.component(.month, from: targetDay) == calendar.component(.month, from: startDay)
            else { return false }
            let years = calendar.dateComponents([.year], from: startDay, to: targetDay).year ?? 0
            return years % interval == 0
        default:
            return false
        }
    }

    /// Whole weeks between the weeks containing a and b (week starts Monday,
    /// matching dateutil's default for European rules).
    private static func weeksBetween(_ a: Date, _ b: Date) -> Int {
        var cal = calendar
        cal.firstWeekday = 2  // Monday
        guard let aStart = cal.dateInterval(of: .weekOfYear, for: a)?.start,
              let bStart = cal.dateInterval(of: .weekOfYear, for: b)?.start else { return 0 }
        return (cal.dateComponents([.day], from: aStart, to: bStart).day ?? 0) / 7
    }
}
