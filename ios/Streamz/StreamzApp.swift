/*
 StreamzApp.swift

 SETUP INSTRUCTIONS:
 1. Open Xcode → File → New → Project → iOS App
 2. Product Name: "Streamz", Language: Swift, Interface: SwiftUI
 3. Delete the auto-generated ContentView.swift and any default files
 4. Copy ALL files from this project structure into the Xcode project:
    Streamz/
    ├── StreamzApp.swift
    ├── Info.plist
    ├── Models/
    │   ├── User.swift
    │   ├── Video.swift
    │   └── Purchase.swift
    ├── Services/
    │   ├── APIClient.swift
    │   ├── AuthService.swift
    │   ├── VideoService.swift
    │   ├── PurchaseService.swift
    │   └── StreamingService.swift
    ├── ViewModels/
    │   ├── AuthViewModel.swift
    │   ├── HomeViewModel.swift
    │   └── VideoDetailViewModel.swift
    ├── Views/
    │   ├── LoginView.swift
    │   ├── HomeView.swift
    │   ├── VideoDetailView.swift
    │   ├── PlayerView.swift
    │   ├── PurchaseView.swift
    │   └── ProfileView.swift
    └── Helpers/
        ├── KeychainManager.swift
        └── StripeManager.swift

 5. Add Stripe iOS SDK via Swift Package Manager:
    - File → Add Package Dependencies
    - URL: https://github.com/stripe/stripe-ios
    - Version: Up to Next Major → 23.x or later
    - Add "StripePaymentSheet" to your target

 6. Set Info.plist (right-click project → Add to "Streamz"):
    - Allow arbitrary loads = YES (for localhost dev)
    - Transport security settings configured

 7. Ensure your backend is running on localhost:3000
    - If testing on simulator, localhost works directly
    - For device, use your machine's IP and update BASE_URL in APIClient.swift

 8. Build and run (⌘R)
*/

import SwiftUI
import StripePaymentSheet

@main
struct StreamzApp: App {
    @StateObject private var authVM = AuthViewModel()

    init() {
        StripeAPI.defaultPublishableKey = "pk_test_placeholder"
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authVM)
                .preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var hasCheckedAuth = false

    var body: some View {
        Group {
            if hasCheckedAuth {
                if authVM.isAuthenticated {
                    HomeView()
                        .environmentObject(authVM)
                        .transition(.opacity)
                } else {
                    LoginView()
                        .environmentObject(authVM)
                        .transition(.opacity)
                }
            } else {
                ZStack {
                    Color.black.ignoresSafeArea()
                    VStack(spacing: 16) {
                        Text("Streamz")
                            .font(.system(size: 48, weight: .bold, design: .rounded))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.red, .orange],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                        ProgressView()
                            .tint(.white)
                    }
                }
            }
        }
        .animation(.easeInOut(duration: 0.3), value: authVM.isAuthenticated)
        .task {
            await authVM.checkAuth()
            withAnimation { hasCheckedAuth = true }
        }
    }
}
