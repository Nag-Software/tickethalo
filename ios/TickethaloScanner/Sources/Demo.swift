#if DEBUG
import Foundation

/// Demodata for debug-bygg: start med `TICKETHALO_DEMO=1` i miljøet, så er
/// appen innlogget med noen show og gjester uten nett. Brukes til å se over
/// skjermene i simulatoren og til App Store-skjermbilder. Finnes ikke i
/// release-bygg.
enum Demo {
    static let isEnabled = ProcessInfo.processInfo.environment["TICKETHALO_DEMO"] == "1"

    static let session = AuthStore.Session(
        accessToken: "demo", refreshToken: "demo",
        expiresAt: .distantFuture, email: "door@example.com"
    )

    private static let today = Show.dayFormatter.string(from: Date())
    private static func day(_ offset: Int) -> String {
        Show.dayFormatter.string(from: Calendar.current.date(byAdding: .day, value: offset, to: Date())!)
    }

    private static var tickets: [[String: Any]] = [
        ["id": "t1", "ticket_code": "K7QM2XPA", "status": "used", "checked_in_at": ISO8601DateFormatter().string(from: Date().addingTimeInterval(-900)), "holder_name": "Ingrid Haugen", "type_name": "Standard", "buyer_name": "Ingrid Haugen", "buyer_email": "ingrid@example.com"],
        ["id": "t2", "ticket_code": "B3RT9WZE", "status": "valid", "checked_in_at": NSNull(), "holder_name": "Jonas Berg", "type_name": "Standard", "buyer_name": "Jonas Berg", "buyer_email": "jonas@example.com"],
        ["id": "t3", "ticket_code": "M4NV8QLC", "status": "valid", "checked_in_at": NSNull(), "holder_name": "Sara Lie", "type_name": "Student", "buyer_name": "Jonas Berg", "buyer_email": "jonas@example.com"],
        ["id": "t4", "ticket_code": "P2DX6HJT", "status": "refunded", "checked_in_at": NSNull(), "holder_name": "Ola Nordmann", "type_name": "Standard", "buyer_name": "Ola Nordmann", "buyer_email": "ola@example.com"],
        ["id": "t5", "ticket_code": "Z9FK3RUA", "status": "used", "checked_in_at": ISO8601DateFormatter().string(from: Date().addingTimeInterval(-300)), "holder_name": NSNull(), "type_name": "Standard", "buyer_name": "Emma Dahl", "buyer_email": "emma@example.com"],
    ]

    /// Samme JSON som serveren svarer med, så dekodingen blir prøvd også.
    static func response(path: String, body: [String: String]?) -> Data {
        let json: Any
        if path.hasSuffix("scanner/me") {
            json = ["name": "Door Staff", "email": "door@example.com", "role": "staff",
                    "clubs": [["id": "c1", "name": "Northside Comedy Club", "city": "Oslo"], ["id": "c2", "name": "Harbour Laughs", "city": "Bergen"]],
                    "selectedClubId": "c1"]
        } else if path.hasSuffix("scanner/shows") {
            json = ["shows": [
                show("s1", "Stand-up Night", today, "20:00:00"),
                show("s2", "New Talent Night", day(3), "19:30:00"),
                show("s3", "Late Show", day(-4), "22:00:00", status: "completed"),
            ]]
        } else if path.hasSuffix("/check-in") {
            let code = body?["code"]?.uppercased() ?? ""
            if let index = tickets.firstIndex(where: { $0["ticket_code"] as? String == code }) {
                let ticket = tickets[index]
                switch ticket["status"] as? String {
                case "valid":
                    tickets[index]["status"] = "used"
                    tickets[index]["checked_in_at"] = ISO8601DateFormatter().string(from: Date())
                    json = ["ok": true, "ticketId": ticket["id"]!, "ticketCode": code, "holderName": ticket["holder_name"]!]
                case "used":
                    json = ["alreadyUsed": true, "checkedInAt": ticket["checked_in_at"]!, "holderName": ticket["holder_name"]!]
                default:
                    json = ["invalid": true, "status": ticket["status"]!]
                }
            } else if code == "WRONG123" {
                json = ["wrongShow": true, "showTitle": "New Talent Night", "showDate": day(3), "holderName": "Kari Holm"]
            } else {
                json = ["notFound": true]
            }
        } else if path.hasSuffix("/undo") {
            if let index = tickets.firstIndex(where: { $0["id"] as? String == body?["ticketId"] }) {
                tickets[index]["status"] = "valid"
                tickets[index]["checked_in_at"] = NSNull()
            }
            json = ["ok": true]
        } else {
            json = ["show": show("s1", "Stand-up Night", today, "20:00:00"),
                    "tickets": tickets]
        }
        return try! JSONSerialization.data(withJSONObject: json)
    }

    private static func show(_ id: String, _ title: String, _ date: String, _ time: String, status: String = "published") -> [String: Any] {
        ["id": id, "title": title, "date": date, "time": time, "venue": "Main Stage", "status": status]
    }

}
#endif
