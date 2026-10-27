import Capacitor
import UIKit
import UserNotifications

class CompassViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CompassSessionPlugin())
    }
}

@objc(CompassSessionPlugin)
public class CompassSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CompassSessionPlugin"
    public let jsName = "CompassSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "clearNotificationsForLogout", returnType: CAPPluginReturnPromise)
    ]

    @objc func clearNotificationsForLogout(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Works on a fresh process and when notification permission was
            // denied; it does not depend on the push plugin's APNs callback flag.
            UIApplication.shared.unregisterForRemoteNotifications()
            let center = UNUserNotificationCenter.current()
            center.removeAllDeliveredNotifications()
            center.removeAllPendingNotificationRequests()
            UIApplication.shared.applicationIconBadgeNumber = 0
            call.resolve()
        }
    }
}
