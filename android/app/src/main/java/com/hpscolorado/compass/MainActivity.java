package com.hpscolorado.compass;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean isFieldReturnIntent(Intent intent) {
        Uri url = intent == null ? null : intent.getData();
        return url != null
            && "compass".equalsIgnoreCase(url.getScheme())
            && "field".equalsIgnoreCase(url.getHost());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (isFieldReturnIntent(intent) && bridge != null) {
            // Full Compass replaces the bundled page in this webview. Reloading
            // the configured app URL restores the offline-capable Field shell.
            bridge.reload();
            return;
        }
        super.onNewIntent(intent);
    }
}
