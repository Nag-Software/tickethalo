import SwiftUI

/// Gjestelista: søk på navn, e-post eller kode. Sveip for å sjekke inn
/// manuelt (gjesten har ikke billetten for hånden) eller angre en feil.
struct GuestListView: View {
    let show: Show
    @Binding var tickets: [Ticket]
    let onCheckIn: (String) -> Void
    let onRefresh: () async -> Void

    @Environment(APIClient.self) private var api
    @State private var query = ""
    @State private var filter: Filter = .all
    @State private var undoTarget: Ticket?
    @State private var error: String?

    enum Filter: String, CaseIterable { case all = "All", waiting = "Not in", inside = "Checked in" }

    private var visible: [Ticket] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "-", with: "")
        return tickets.filter { ticket in
            switch filter {
            case .all: true
            case .waiting: !ticket.isCheckedIn && ticket.status == "valid"
            case .inside: ticket.isCheckedIn
            }
        }
        .filter { ticket in
            guard !needle.isEmpty else { return true }
            return [ticket.holder_name, ticket.buyer_name, ticket.buyer_email, ticket.ticket_code]
                .compactMap { $0?.lowercased() }
                .contains { $0.contains(needle) }
        }
        .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }

    var body: some View {
        List {
            Picker("Filter", selection: $filter) {
                ForEach(Filter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)

            if let error {
                Text(error).foregroundStyle(Theme.danger).font(.subheadline)
            }

            ForEach(visible) { ticket in
                row(ticket)
                    .swipeActions(edge: .trailing) {
                        if ticket.isCheckedIn {
                            Button("Undo", systemImage: "arrow.uturn.backward") { undoTarget = ticket }
                                .tint(Theme.warning)
                        } else if ticket.status == "valid" {
                            Button("Check in", systemImage: "checkmark") { onCheckIn(ticket.ticket_code) }
                                .tint(Theme.success)
                        }
                    }
            }

            if visible.isEmpty {
                Text(query.isEmpty ? "No tickets yet." : "No guests match \u{201C}\(query)\u{201D}.")
                    .foregroundStyle(Theme.muted)
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .contentMargins(.top, 12, for: .scrollContent)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name, email or code")
        .refreshable { await onRefresh() }
        .confirmationDialog(
            "Undo check-in for \(undoTarget?.displayName ?? "")?",
            isPresented: Binding(get: { undoTarget != nil }, set: { if !$0 { undoTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("Undo check-in", role: .destructive) {
                if let ticket = undoTarget { Task { await undo(ticket) } }
            }
        } message: {
            Text("The ticket can be scanned again.")
        }
    }

    private func row(_ ticket: Ticket) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon(for: ticket))
                .font(.title3)
                .foregroundStyle(color(for: ticket))
            VStack(alignment: .leading, spacing: 3) {
                Text(ticket.displayName).font(.body.weight(.medium)).foregroundStyle(Theme.text)
                Text(detail(for: ticket)).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            if let time = Timestamp.clock(ticket.checked_in_at), ticket.isCheckedIn {
                Text(time).font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
            }
        }
        .listRowBackground(Theme.card)
    }

    private func detail(for ticket: Ticket) -> String {
        var parts = [ticket.formattedCode]
        if let type = ticket.type_name { parts.append(type) }
        if ticket.status == "refunded" { parts.append("Refunded") }
        if ticket.status == "cancelled" { parts.append("Cancelled") }
        if let buyer = ticket.buyer_name, buyer != ticket.holder_name, ticket.holder_name != nil { parts.append("Bought by \(buyer)") }
        return parts.joined(separator: " · ")
    }

    private func icon(for ticket: Ticket) -> String {
        switch ticket.status {
        case "used": "checkmark.circle.fill"
        case "valid": "circle"
        default: "xmark.circle"
        }
    }

    private func color(for ticket: Ticket) -> Color {
        switch ticket.status {
        case "used": Theme.success
        case "valid": Theme.muted
        default: Theme.danger
        }
    }

    private func undo(_ ticket: Ticket) async {
                do {
            try await api.undo(showId: show.id, ticketId: ticket.id)
            if let index = tickets.firstIndex(where: { $0.id == ticket.id }) {
                tickets[index].status = "valid"
                tickets[index].checked_in_at = nil
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        undoTarget = nil
    }
}
