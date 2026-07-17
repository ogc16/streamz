import Foundation

struct Video: Codable, Identifiable {
    let id: String
    let title: String
    let description: String
    let thumbnailUrl: String?
    let playbackId: String?
    let durationSeconds: Int?
    let priceCents: Int
    let rentalPriceCents: Int?
    let rentalDurationHours: Int?
    let genre: String
    let releaseYear: Int?
    let rating: String?
    let featured: Bool?
    let purchaseType: String?
    let createdAt: String?

    var priceDisplay: String {
        let dollars = Double(priceCents) / 100.0
        return String(format: "$%.2f", dollars)
    }

    var rentalPriceDisplay: String {
        guard let cents = rentalPriceCents else { return priceDisplay }
        let dollars = Double(cents) / 100.0
        return String(format: "$%.2f", dollars)
    }

    var durationDisplay: String {
        let totalSeconds = durationSeconds ?? 0
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        if minutes >= 60 {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            return "\(hours)h \(remainingMinutes)m"
        }
        return "\(minutes)m \(seconds)s"
    }

    var yearDisplay: String {
        guard let year = releaseYear else { return "" }
        return "\(year)"
    }
}

struct VideoListResponse: Codable {
    let items: [Video]
    let total: Int
    let page: Int
    let limit: Int
}

struct VideoDetailResponse: Codable {
    let id: String
    let title: String
    let description: String
    let thumbnailUrl: String?
    let playbackId: String?
    let durationSeconds: Int?
    let priceCents: Int
    let rentalPriceCents: Int?
    let rentalDurationHours: Int?
    let genre: String
    let releaseYear: Int?
    let rating: String?
    let featured: Bool?
    let purchaseType: String?
    let createdAt: String?
    let purchased: Bool?
    let expiresAt: String?

    var priceDisplay: String {
        let dollars = Double(priceCents) / 100.0
        return String(format: "$%.2f", dollars)
    }

    var rentalPriceDisplay: String {
        guard let cents = rentalPriceCents else { return priceDisplay }
        let dollars = Double(cents) / 100.0
        return String(format: "$%.2f", dollars)
    }

    var durationDisplay: String {
        let totalSeconds = durationSeconds ?? 0
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        if minutes >= 60 {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            return "\(hours)h \(remainingMinutes)m"
        }
        return "\(minutes)m \(seconds)s"
    }
}

struct GenreCount: Codable, Identifiable {
    let genre: String
    let count: Int

    var id: String { genre }
}
