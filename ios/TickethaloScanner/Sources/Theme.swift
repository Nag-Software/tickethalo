import SwiftUI

/// Den mørke varianten av nettsidens flate (`.ev-surface[data-tone='dark']`
/// i app/globals.css), så appen ser ut som resten av Tickethalo.
///
/// Appen er alltid mørk (`UIUserInterfaceStyle` = Dark i Info.plist): den
/// brukes i mørke lokaler, og systemkomponentene (menyer, søkefelt, ark)
/// følger da samme modus som fargene her.
enum Theme {
    static let background = Color(hex: 0x1B0800)
    /// Ark og andre flater som ligger over bakgrunnen.
    static let elevated = Color(hex: 0x2A1308)
    static let text = Color(hex: 0xFFF4EC)
    static let muted = text.opacity(0.78)
    static let faint = text.opacity(0.6)
    static let card = text.opacity(0.06)
    static let line = text.opacity(0.12)
    static let accent = Color(hex: 0xFF985F)
    static let accentFill = Color(hex: 0xFF5B24)
    /// Tekst på `text`- og `accentFill`-flater (primærknappene).
    static let accentInk = Color(hex: 0x2E0C01)

    // Flatefarger på resultatskjermen og sveipeknappene. Hvit tekst står på
    // dem, så alle tre holder minst 4.5:1 mot hvitt.
    static let success = Color(hex: 0x0B7A42)
    static let warning = Color(hex: 0xB45309)
    static let danger = Color(hex: 0xC01C1C)

    // Samme utfall som tekst og ikoner rett på den mørke bakgrunnen.
    static let successText = Color(hex: 0x5FD38D)
    static let warningText = Color(hex: 0xFFB454)
    static let dangerText = Color(hex: 0xFF8A80)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
