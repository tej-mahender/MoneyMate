package com.pfos.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the web app's dashboard totals into a native SharedPreferences file so the
 * home-screen widget (BalanceWidgetProvider) can render without ever opening the app
 * or touching the WebView's IndexedDB. Call WidgetBridge.updateWidget(...) from the
 * dashboard whenever totals change; everything here stays on-device.
 *
 * Also carries the widget's "+" button back to the web app: MainActivity stashes a
 * pending route into the same prefs file when launched from it, and getPendingRoute()
 * lets the web layer pick that up on boot. This avoids a second WebView/JS-interface
 * entirely — the "+" button just deep-links into the app's own normal /add screen.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    public static final String PREFS_NAME = "pfos_widget";

    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();

        editor.putString("currency", call.getString("currency", "₹"));
        editor.putString("monthLabel", call.getString("monthLabel", ""));
        editor.putFloat("spent", floatVal(call.getDouble("spent", 0.0)));
        editor.putFloat("budget", floatVal(call.getDouble("budget", 0.0)));
        editor.putFloat("remaining", floatVal(call.getDouble("remaining", 0.0)));
        editor.putBoolean("hideAmounts", Boolean.TRUE.equals(call.getBoolean("hideAmounts", false)));
        editor.putLong("updatedAt", System.currentTimeMillis());
        editor.apply();

        // Ask Android to redraw every instance of the widget right now.
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, BalanceWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(provider);
        if (ids != null && ids.length > 0) {
            BalanceWidgetProvider.pushUpdate(context, mgr, ids);
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPendingRoute(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String route = prefs.getString("pendingRoute", null);
        if (route != null) {
            prefs.edit().remove("pendingRoute").apply();
        }
        JSObject ret = new JSObject();
        ret.put("route", route);
        call.resolve(ret);
    }

    private float floatVal(Double d) {
        return d == null ? 0f : d.floatValue();
    }
}
