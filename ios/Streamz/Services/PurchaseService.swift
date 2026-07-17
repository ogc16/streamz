import Foundation

final class PurchaseService {

    static let shared = PurchaseService()

    private let client = APIClient.shared

    private init() {}

    func createPaymentIntent(videoId: String, type: String) async throws -> PaymentIntentResponse {
        let request = PaymentIntentRequest(videoId: videoId, type: type)
        return try await client.request(
            path: "/api/purchases/create-payment-intent",
            method: "POST",
            body: request
        )
    }

    func getPurchases() async throws -> [PurchaseWithVideo] {
        try await client.request(path: "/api/purchases")
    }

    func checkAccess(videoId: String) async throws -> AccessCheckResponse {
        try await client.request(path: "/api/purchases/check/\(videoId)")
    }
}
