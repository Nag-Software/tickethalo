import AVFoundation
import SwiftUI
import UIKit

/// Bakkameraet med QR-lesing. Hver lest kode sendes til `onCode`;
/// skjermen bak bestemmer hva som skjer med gjentatte lesninger.
struct CameraScanner: UIViewRepresentable {
    /// Av mens gjestelista er oppe eller appen er i bakgrunnen. Økta stoppes
    /// og startes på kamerakøen — visningen og økta beholdes.
    var isActive: Bool
    var torchOn: Bool
    var onCode: (String) -> Void
    var onFailure: (CameraFailure) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode, onFailure: onFailure) }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.videoGravity = .resizeAspectFill
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        context.coordinator.onCode = onCode
        context.coordinator.setActive(isActive)
        context.coordinator.setTorch(isActive && torchOn)
    }

    static func dismantleUIView(_ view: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        var onCode: (String) -> Void
        let onFailure: (CameraFailure) -> Void
        private let session = AVCaptureSession()
        private let queue = DispatchQueue(label: "com.tickethalo.scanner.camera")
        private var device: AVCaptureDevice?
        /// Leses og skrives bare på `queue`.
        private var isConfigured = false
        private var wantsRunning = true

        init(onCode: @escaping (String) -> Void, onFailure: @escaping (CameraFailure) -> Void) {
            self.onCode = onCode
            self.onFailure = onFailure
        }

        func attach(to view: PreviewView) {
            view.previewLayer.session = session
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                configure()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    if granted { self.configure() } else { self.fail(.denied) }
                }
            default:
                fail(.denied)
            }
        }

        private func configure() {
            queue.async {
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                      let input = try? AVCaptureDeviceInput(device: device) else {
                    self.fail(.unavailable)
                    return
                }
                self.device = device
                self.session.beginConfiguration()
                if self.session.canAddInput(input) { self.session.addInput(input) }
                let output = AVCaptureMetadataOutput()
                if self.session.canAddOutput(output) {
                    self.session.addOutput(output)
                    output.setMetadataObjectsDelegate(self, queue: .main)
                    output.metadataObjectTypes = [.qr]
                }
                self.session.commitConfiguration()
                // Billetter holdes tett inntil — autofokus nært gir raskere lesing.
                if (try? device.lockForConfiguration()) != nil {
                    if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
                    device.unlockForConfiguration()
                }
                self.isConfigured = true
                if self.wantsRunning { self.session.startRunning() }
            }
        }

        func setActive(_ active: Bool) {
            queue.async {
                self.wantsRunning = active
                guard self.isConfigured else { return }
                if active, !self.session.isRunning { self.session.startRunning() }
                if !active, self.session.isRunning { self.session.stopRunning() }
            }
        }

        func setTorch(_ on: Bool) {
            queue.async {
                guard let device = self.device, device.hasTorch else { return }
                let mode: AVCaptureDevice.TorchMode = on ? .on : .off
                guard device.torchMode != mode, device.isTorchModeSupported(mode),
                      (try? device.lockForConfiguration()) != nil else { return }
                device.torchMode = mode
                device.unlockForConfiguration()
            }
        }

        func stop() {
            queue.async {
                self.wantsRunning = false
                if self.session.isRunning { self.session.stopRunning() }
            }
        }

        private func fail(_ failure: CameraFailure) {
            DispatchQueue.main.async { self.onFailure(failure) }
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard let code = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
            onCode(code)
        }
    }
}

enum CameraFailure {
    case denied, unavailable

    var message: String {
        switch self {
        case .denied: "Camera access is off. Allow it in Settings to scan tickets, or type the code instead."
        case .unavailable: "No camera available. Type the ticket code instead."
        }
    }
}
