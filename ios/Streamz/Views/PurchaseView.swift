import SwiftUI
import StripePaymentSheet

struct PurchaseView: UIViewControllerRepresentable {
    let clientSecret: String
    let amount: Int
    let onCompleted: () -> Void
    let onFailed: () -> Void

    func makeUIViewController(context: Context) -> PurchaseViewController {
        let vc = PurchaseViewController()
        vc.clientSecret = clientSecret
        vc.amount = amount
        vc.onCompleted = onCompleted
        vc.onFailed = onFailed
        return vc
    }

    func updateUIViewController(_ uiViewController: PurchaseViewController, context: Context) {}
}

class PurchaseViewController: UIViewController, PaymentSheetViewControllerDelegate {
    var clientSecret: String = ""
    var amount: Int = 0
    var onCompleted: (() -> Void)?
    var onFailed: (() -> Void)?

    private var paymentSheet: PaymentSheet?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        var configuration = PaymentSheet.Configuration()
        configuration.merchantDisplayName = "Streamz"
        configuration.applePayEnabled = true
        configuration.style = .alwaysDark
        configuration.presentedFrom = self

        paymentSheet = PaymentSheet(
            paymentIntentClientSecret: clientSecret,
            configuration: configuration
        )

        presentPaymentSheet()
    }

    private func presentPaymentSheet() {
        guard let sheet = paymentSheet else {
            onFailed?()
            dismiss(animated: true)
            return
        }

        sheet.present(from: self) { [weak self] result in
            switch result {
            case .completed:
                self?.onCompleted?()
                self?.dismiss(animated: true)
            case .canceled:
                self?.onFailed?()
                self?.dismiss(animated: true)
            case .failed(let error):
                self?.onFailed?()
                self?.dismiss(animated: true)
            }
        }
    }
}
