package com.pfos.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        stashPendingRoute(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // The launchMode="singleTask" manifest entry means a second tap on the
        // widget's "+" button while the app is already running re-delivers
        // here instead of triggering a fresh onCreate — without this override
        // that tap would silently do nothing.
        stashPendingRoute(intent);
    }

    /** Mirrors WidgetBridgePlugin.PREFS_NAME/"pendingRoute" — see its getPendingRoute(). */
    private void stashPendingRoute(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra("route");
        if (route == null) return;
        SharedPreferences prefs = getSharedPreferences(WidgetBridgePlugin.PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString("pendingRoute", route).apply();
    }
}
