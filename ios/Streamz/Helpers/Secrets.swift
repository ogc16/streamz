import Foundation

/// Central runtime config for Streamz.
///
/// Mirrors the Android BuildConfig pattern: Swift source never contains
/// environment literals. Values resolve from Info.plist keys at build time.
///
/// The publishable Stripe key and API base URL are PUBLIC dev config that ships
/// in the binary by design — they are not secrets. Real credentials (JWT
/// access/refresh tokens) live in the Keychain via KeychainManager, never here.
/// To point at a live backend, override the Info.plist keys at build time
/// (e.g. a gitignored .xcconfig feeding $(API_BASE_URL)) — do NOT edit source.
enum Secrets {

    static var apiBaseURL: String {
        Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
            ?? "http://localhost:3000"
    }

    static var stripePublishableKey: String {
        Bundle.main.object(forInfoDictionaryKey: "STRIPE_PUBLISHABLE_KEY") as? String
            ?? "pk_test_stripe_key"
    }
}
</content>
