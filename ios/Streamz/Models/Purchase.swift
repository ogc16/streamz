import Foundation

struct Purchase: Codable, Identifiable {
    let id: String
    let userId: String
    let videoId: String
    let type: String
    let amountCents: Int
    let status: String
    let expiresAt: String?
    let createdAt: String?

    var amountDisplay: String {
        let dollars = Double(amountCents) / 100.0
        return String(format: "$%.2f", dollars)
    }
}

struct PurchaseWithVideo: Codable, Identifiable {
    let purchase: Purchase
    let video: Video

    var id: String { purchase.id }
}

struct PaymentIntentRequest: Codable {
    let videoId: String
    let type: String
}

struct PaymentIntentResponse: Codable {
    let clientSecret: String
    let amount: Int
}

struct AccessCheckResponse: Codable {
    let hasAccess: Bool
    let type: String?
    let expiresAt: String?
}
