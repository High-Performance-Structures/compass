package com.hpscolorado.compass;

import android.app.NotificationManager;
import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "CompassSession")
public class CompassSessionPlugin extends Plugin {
    @PluginMethod
    public void clearNotificationsForLogout(PluginCall call) {
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(false);
        // Logout must remain pending until Firebase confirms deletion. The
        // stock push plugin resolves before this network task finishes.
        messaging.deleteToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Could not stop notifications. Connect to the internet and retry logout.", task.getException());
                return;
            }
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.cancelAll();
            call.resolve();
        });
    }
}
