package com.pfos.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.util.Locale;

public class BalanceWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        pushUpdate(context, appWidgetManager, appWidgetIds);
    }

    /** Called both by Android's normal widget update cycle and directly by WidgetBridgePlugin
     *  right after the web app writes fresh totals, so the widget feels instant rather than
     *  waiting for the next scheduled refresh. */
    public static void pushUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String currency = prefs.getString("currency", "₹");
        String monthLabel = prefs.getString("monthLabel", "");
        float spent = prefs.getFloat("spent", 0f);
        float budget = prefs.getFloat("budget", 0f);
        float remaining = prefs.getFloat("remaining", 0f);
        boolean hasData = prefs.contains("updatedAt");
        boolean hideAmounts = prefs.getBoolean("hideAmounts", false);

        int pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.balance_widget);

            if (!hasData) {
                views.setTextViewText(R.id.widget_title, "Money Mate");
                views.setTextViewText(R.id.widget_amount, "Open app to sync");
                views.setTextViewText(R.id.widget_sub, "No data yet");
                views.setProgressBar(R.id.widget_progress, 100, 0, false);
            } else if (hideAmounts) {
                // Privacy mode (Settings → Home-screen widget): the widget is
                // glanceable to anyone near the phone, including on the lock
                // screen if placed there, so no figures get shown at all —
                // only the progress bar, which still gives a rough sense of
                // "how's this month going" without exposing exact amounts.
                views.setTextViewText(R.id.widget_title, monthLabel.isEmpty() ? "This month" : monthLabel);
                views.setTextViewText(R.id.widget_amount, "•••• left");
                views.setTextViewText(R.id.widget_sub, "Amounts hidden");
                views.setProgressBar(R.id.widget_progress, 100, pct, false);
            } else {
                views.setTextViewText(R.id.widget_title, monthLabel.isEmpty() ? "This month" : monthLabel);
                views.setTextViewText(R.id.widget_amount, money(remaining, currency) + " left");
                String subLine = money(spent, currency) + " spent of " + money(budget, currency);
                views.setTextViewText(R.id.widget_sub, subLine);
                views.setProgressBar(R.id.widget_progress, 100, pct, false);
            }

            // Tapping the widget body opens the app — the one deliberate exception to
            // "glanceable without opening," since a tap is an explicit request to go deeper.
            Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (launchIntent != null) {
                PendingIntent pending = PendingIntent.getActivity(
                    context, 0, launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(R.id.widget_root, pending);
            }

            // The "+" button opens the app straight to the add-transaction screen
            // instead. This deep-links into the app's own normal /add screen (via
            // MainActivity + WidgetBridgePlugin.getPendingRoute(), read once on
            // boot) rather than a second WebView with its own JS bridge — no new
            // attack surface, just an intent extra.
            Intent addIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (addIntent != null) {
                addIntent.putExtra("route", "/add");
                // A distinct request code from the body's PendingIntent above —
                // otherwise FLAG_UPDATE_CURRENT would make them collide and only
                // one of the two click targets would actually work.
                PendingIntent addPending = PendingIntent.getActivity(
                    context, 1, addIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(R.id.widget_add_button, addPending);
            }

            appWidgetManager.updateAppWidget(id, views);
        }
    }

    private static String money(float amount, String currency) {
        NumberFormat nf = NumberFormat.getNumberInstance(new Locale("en", "IN"));
        nf.setMaximumFractionDigits(0);
        return currency + nf.format(amount);
    }
}
