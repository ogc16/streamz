import Foundation
import StripePaymentSheet

struct StripeManager {

    static let shared = StripeManager()

    private init() {}

    func createPaymentSheet(
        clientSecret: String,
        amount: Int,
        completion: @escaping (PaymentSheet?) -> Void
    ) {
        var configuration = PaymentSheet.Configuration()
        configuration.merchantDisplayName = "Streamz"
        configuration.applePayEnabled = true
        configuration.style = .alwaysDark

        let sheet = PaymentSheet(
            paymentIntentClientSecret: clientSecret,
            configuration: configuration
        )
        completion(sheet)
    }
}
