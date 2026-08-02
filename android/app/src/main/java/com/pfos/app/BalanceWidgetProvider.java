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

        int pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.balance_widget);

            if (!hasData) {
                views.setTextViewText(R.id.widget_title, "Finance OS");
                views.setTextViewText(R.id.widget_amount, "Open app to sync");
                views.setTextViewText(R.id.widget_sub, "No data yet");
                views.setProgressBar(R.id.widget_progress, 100, 0, false);
            } else {
                views.setTextViewText(R.id.widget_title, monthLabel.isEmpty() ? "This month" : monthLabel);
                views.setTextViewText(R.id.widget_amount, money(remaining, currency) + " left");
                String subLine = money(spent, currency) + " spent of " + money(budget, currency);
                views.setTextViewText(R.id.widget_sub, subLine);
                views.setProgressBar(R.id.widget_progress, 100, pct, false);
            }

            // Tapping the widget opens the app — the one deliberate exception to
            // "glanceable without opening," since a tap is an explicit request to go deeper.
            Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (launchIntent != null) {
                PendingIntent pending = PendingIntent.getActivity(
                    context, 0, launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(R.id.widget_root, pending);
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
