import SwiftUI

/// Fargene fra nettsiden (`--ev-*` i app/globals.css), så appen ser ut som
/// resten av Tickethalo. Skannevisningen er mørk med vilje: kameraet er bildet.
///
/// Appen er låst til lys modus (`UIUserInterfaceStyle` i Info.plist og
/// `.preferredColorScheme(.light)`). Bakgrunnen er alltid den lyse kremfargen,
/// så systemtekst som fulgte mørk modus ble hvit på lyst.
enum Theme {
    static let background = Color(red: 0xFD / 255, green: 0xF4 / 255, blue: 0xED / 255)
    static let text = Color(red: 0x2E / 255, green: 0x0C / 255, blue: 0x01 / 255)
    static let muted = text.opacity(0.72)
    static let card = text.opacity(0.05)
    static let line = text.opacity(0.12)
    static let accent = Color(red: 0xB2 / 255, green: 0x30 / 255, blue: 0x04 / 255)
    static let accentFill = Color(red: 0xFF / 255, green: 0x5B / 255, blue: 0x24 / 255)
    static let accentInk = Color(red: 0xFF / 255, green: 0xF4 / 255, blue: 0xEC / 255)

    // Hvit tekst står på disse (resultatskjermen og sveipeknappene), så alle
    // tre holder minst 4.5:1 mot hvitt.
    static let success = Color(red: 0x0B / 255, green: 0x7A / 255, blue: 0x42 / 255)
    static let warning = Color(red: 0xB4 / 255, green: 0x53 / 255, blue: 0x09 / 255)
    static let danger = Color(red: 0xC0 / 255, green: 0x1C / 255, blue: 0x1C / 255)
    /// Feiltekst på den svarte toppen i skanneren — `danger` er for mørk der.
    static let dangerOnDark = Color(red: 0xFF / 255, green: 0x8A / 255, blue: 0x80 / 255)
}
