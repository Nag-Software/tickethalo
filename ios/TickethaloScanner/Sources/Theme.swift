import SwiftUI

/// Fargene fra nettsiden (`--ev-*` i app/globals.css), så appen ser ut som
/// resten av Tickethalo. Skannevisningen er mørk med vilje: kameraet er bildet.
enum Theme {
    static let background = Color(red: 0xFD / 255, green: 0xF4 / 255, blue: 0xED / 255)
    static let text = Color(red: 0x2E / 255, green: 0x0C / 255, blue: 0x01 / 255)
    static let muted = text.opacity(0.72)
    static let card = text.opacity(0.05)
    static let line = text.opacity(0.12)
    static let accent = Color(red: 0xB2 / 255, green: 0x30 / 255, blue: 0x04 / 255)
    static let accentFill = Color(red: 0xFF / 255, green: 0x5B / 255, blue: 0x24 / 255)
    static let accentInk = Color(red: 0xFF / 255, green: 0xF4 / 255, blue: 0xEC / 255)

    static let success = Color(red: 0.06, green: 0.55, blue: 0.30)
    static let warning = Color(red: 0.85, green: 0.55, blue: 0.05)
    static let danger = Color(red: 0.78, green: 0.12, blue: 0.12)
}
