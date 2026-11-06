import Foundation

struct Club: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let city: String?
}

struct Me: Codable {
    let name: String?
    let email: String
    let role: String
    let clubs: [Club]
    let selectedClubId: String?
}

struct Show: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let date: String?
    let time: String?
    let venue: String?
    let status: String

    var dateValue: Date? { date.flatMap { Show.dayFormatter.date(from: $0) } }

    /// «Fri 14 Nov · 20:00 · Venue»
    var subtitle: String {
        var parts: [String] = []
        if let day = dateValue { parts.append(Show.displayFormatter.string(from: day)) } else if let date { parts.append(date) }
        if let time, !time.isEmpty { parts.append(String(time.prefix(5))) }
        if let venue, !venue.isEmpty { parts.append(venue) }
        return parts.joined(separator: " · ")
    }

    var statusLabel: String {
        switch status {
        case "published": "On sale"
        case "fullbooked": "Lineup ready"
        case "completed": "Completed"
        case "booking": "Booking"
        default: status.capitalized
        }
    }

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "EEE d MMM yyyy"
        return f
    }()
}

struct Ticket: Codable, Identifiable, Hashable {
    let id: String
    let ticket_code: String
    var status: String
    var checked_in_at: String?
    let holder_name: String?
    let type_name: String?
    let buyer_name: String?
    let buyer_email: String?

    var isCheckedIn: Bool { status == "used" }
    var displayName: String { holder_name ?? buyer_name ?? buyer_email ?? formattedCode }

    /// Samme visning som `formatTicketCode` på nettsiden: «ABCD-1234».
    var formattedCode: String {
        let code = ticket_code.trimmingCharacters(in: .whitespaces)
        guard code.count == 8 else { return code }
        return "\(code.prefix(4))-\(code.suffix(4))"
    }
}

struct ShowDetail: Codable {
    let show: Show
    let tickets: [Ticket]
}

/// Svaret fra `checkInByCode` — en union der nøkkelen sier hvilket utfall det ble.
enum CheckInResult: Decodable {
    case ok(ticketId: String, ticketCode: String, name: String)
    case alreadyUsed(checkedInAt: String?, holderName: String?)
    case wrongShow(showTitle: String, showDate: String, holderName: String?)
    case invalid(status: String)
    case notFound

    private enum Keys: String, CodingKey {
        case ok, alreadyUsed, wrongShow, invalid, notFound
        case ticketId, ticketCode, holderName, buyerName, buyerEmail
        case checkedInAt, showTitle, showDate, status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        if c.contains(.ok) {
            let code = try c.decode(String.self, forKey: .ticketCode)
            let name = try c.decodeIfPresent(String.self, forKey: .holderName)
                ?? c.decodeIfPresent(String.self, forKey: .buyerName)
                ?? c.decodeIfPresent(String.self, forKey: .buyerEmail)
                ?? code
            self = .ok(ticketId: try c.decode(String.self, forKey: .ticketId), ticketCode: code, name: name)
        } else if c.contains(.alreadyUsed) {
            self = .alreadyUsed(
                checkedInAt: try c.decodeIfPresent(String.self, forKey: .checkedInAt),
                holderName: try c.decodeIfPresent(String.self, forKey: .holderName)
            )
        } else if c.contains(.wrongShow) {
            self = .wrongShow(
                showTitle: try c.decode(String.self, forKey: .showTitle),
                showDate: try c.decode(String.self, forKey: .showDate),
                holderName: try c.decodeIfPresent(String.self, forKey: .holderName)
            )
        } else if c.contains(.invalid) {
            self = .invalid(status: try c.decode(String.self, forKey: .status))
        } else {
            self = .notFound
        }
    }
}

/// Tidsstempler fra Postgres kommer med eller uten brøkdelssekunder.
enum Timestamp {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        return withFraction.date(from: value) ?? plain.date(from: value)
    }

    static func clock(_ value: String?) -> String? {
        guard let date = parse(value) else { return nil }
        return date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }
}
