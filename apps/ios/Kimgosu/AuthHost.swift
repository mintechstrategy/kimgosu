import SwiftUI
import UIKit
import UserNotifications

struct KGAuthHost<Home: View>: View {
    @ObservedObject var model: KGAuthModel
    @ViewBuilder let home: () -> Home
    @Environment(\.scenePhase) private var scenePhase
    private var pages: [KGAuthScreen] { model.stack.filter { !["modal", "sheet"].contains(KGAuthSurfaces[$0]!.kind) } }
    private var overlay: KGAuthScreen? {
        guard let top = model.stack.last, ["modal", "sheet"].contains(KGAuthSurfaces[top]!.kind) else { return nil }; return top
    }
    private var path: Binding<[KGAuthScreen]> {
        Binding(get: { Array(pages.dropFirst()) }, set: { model.popPages(to: $0.count + 1) })
    }
    private var sheet: Binding<Bool> {
        Binding(get: { overlay.map { KGAuthSurfaces[$0]!.kind == "sheet" } ?? false }, set: { if !$0 { model.back() } })
    }
    private func screen(_ screen: KGAuthScreen) -> some View {
        var state = model.state; state.screen = screen
        if model.stack.last != screen { state.busy = false; state.error = "" }
        return KGAuthView(state: state, onEvent: emit)
            .toolbar(.hidden, for: .navigationBar)
            .accessibilityAction(.escape) { model.back() }
            .simultaneousGesture(DragGesture(minimumDistance: 30).onEnded { value in
                if value.startLocation.x < 24 && value.translation.width > 100 && abs(value.translation.height) < 70 { model.back() }
            })
    }
    var body: some View {
        ZStack {
            // A1 stays mounted across auth/document/overlay transitions.
            home().opacity(model.browsing ? 1 : 0).allowsHitTesting(model.stack.isEmpty)
                .accessibilityHidden(!model.stack.isEmpty)
            if !pages.isEmpty {
                NavigationStack(path: path) {
                    screen(pages.first!).navigationDestination(for: KGAuthScreen.self) { screen($0) }
                }.background(Color.white).accessibilityHidden(overlay != nil)
            }
            if let overlay, KGAuthSurfaces[overlay]!.kind == "modal" {
                Color.black.opacity(0.35).ignoresSafeArea().onTapGesture { model.back() }.accessibilityHidden(true)
                screen(overlay).frame(maxWidth: 520, maxHeight: 580).clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(16).shadow(radius: 15).accessibilityAddTraits(.isModal)
            }
        }
        .sheet(isPresented: sheet) {
            if let overlay { screen(overlay).presentationDetents([.medium, .large]).presentationDragIndicator(.visible) }
        }
        .task { model.start(); await updatePermission() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { model.refreshPolicy(); Task { await updatePermission() } } }
    }
    private func emit(_ event: KGAuthEvent) {
        if event.action == .OPEN_OS_SETTINGS {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        } else { model.handle(event) }
    }
    private func updatePermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        model.state.osPermission = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) ? "허용" : "미허용"
    }
}
