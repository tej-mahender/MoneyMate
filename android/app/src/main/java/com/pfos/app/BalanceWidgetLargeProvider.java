package com.pfos.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.View;
import android.widget.RemoteViews;
import java.text.NumberFormat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Larger (4x2) sibling of BalanceWidgetProvider. Same on-device-only data
 * source (the "pfos_widget" SharedPreferences file written by
 * WidgetBridgePlugin) — this just has room to also show a mini per-category
 * breakdown instead of only the month total.
 *
 * Deliberately NOT built with a RemoteViewsService/collection widget: the
 * breakdown is capped at 4 rows by WidgetBridgePlugin before it's even stored,
 * so a fixed-row layout with visibility toggling is simpler and avoids a second
 * native factory/service for no real benefit at this size.
 */
public class BalanceWidgetLargeProvider extends AppWidgetProvider {

    private static final int[] ROW_IDS = {
        R.id.widget_cat_row_1, R.id.widget_cat_row_2, R.id.widget_cat_row_3, R.id.widget_cat_row_4
    };
    private static final int[] ICON_IDS = {
        R.id.widget_cat_icon_1, R.id.widget_cat_icon_2, R.id.widget_cat_icon_3, R.id.widget_cat_icon_4
    };
    private static final int[] NAME_IDS = {
        R.id.widget_cat_name_1, R.id.widget_cat_name_2, R.id.widget_cat_name_3, R.id.widget_cat_name_4
    };
    private static final int[] AMOUNT_IDS = {
        R.id.widget_cat_amount_1, R.id.widget_cat_amount_2, R.id.widget_cat_amount_3, R.id.widget_cat_amount_4
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        pushUpdate(context, appWidgetManager, appWidgetIds);
    }

    /**
     * Called both by Android's normal widget update cycle and directly by
     * WidgetBridgePlugin right after the web app writes fresh totals.
     */
    public static void pushUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String currency = prefs.getString("currency", "₹");
        String monthLabel = prefs.getString("monthLabel", "");
        float spent = prefs.getFloat("spent", 0f);
        float budget = prefs.getFloat("budget", 0f);
        float remaining = prefs.getFloat("remaining", 0f);
        boolean hasData = prefs.contains("updatedAt");
        boolean hideAmounts = prefs.getBoolean("hideAmounts", false);
        String categoriesJson = prefs.getString("categoriesJson", "[]");

        int pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.balance_widget_large);

            if (!hasData) {
                views.setTextViewText(R.id.widget_title, "Money Mate");
                views.setTextViewText(R.id.widget_amount, "Open app to sync");
                views.setTextViewText(R.id.widget_sub, "No data yet");
                views.setProgressBar(R.id.widget_progress, 100, 0, false);
                hideAllCategoryRows(views);
            } else if (hideAmounts) {
                // Same privacy rule as the small widget: no figures, category
                // rows included, since a category name + amount is exactly
                // the kind of detail hideWidgetAmounts exists to suppress.
                views.setTextViewText(R.id.widget_title, monthLabel.isEmpty() ? "This month" : monthLabel);
                views.setTextViewText(R.id.widget_amount, "•••• left");
                views.setTextViewText(R.id.widget_sub, "Amounts hidden");
                views.setProgressBar(R.id.widget_progress, 100, pct, false);
                hideAllCategoryRows(views);
            } else {
                views.setTextViewText(R.id.widget_title, monthLabel.isEmpty() ? "This month" : monthLabel);
                views.setTextViewText(R.id.widget_amount, money(remaining, currency) + " left");
                views.setTextViewText(R.id.widget_sub, money(spent, currency) + " spent of " + money(budget, currency));
                views.setProgressBar(R.id.widget_progress, 100, pct, false);
                renderCategoryRows(views, categoriesJson, currency);
            }

            // Tapping the widget body opens the app.
            Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (launchIntent != null) {
                PendingIntent pending = PendingIntent.getActivity(
                        context, 2, launchIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(R.id.widget_root, pending);
            }

            // The "+" button deep-links straight to /add, same mechanism as the small widget.
            Intent addIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (addIntent != null) {
                addIntent.putExtra("route", "/add");
                // Distinct request codes across BOTH providers (0/1 used by the small
                // widget) so FLAG_UPDATE_CURRENT never collides across widget sizes.
                PendingIntent addPending = PendingIntent.getActivity(
                        context, 3, addIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(R.id.widget_add_button, addPending);
            }

            appWidgetManager.updateAppWidget(id, views);
        }
    }

    private static void renderCategoryRows(RemoteViews views, String categoriesJson, String currency) {
        JSONArray cats;
        try {
            cats = new JSONArray(categoriesJson);
        } catch (JSONException e) {
            cats = new JSONArray();
        }

        int count = Math.min(cats.length(), ROW_IDS.length);
        for (int i = 0; i < ROW_IDS.length; i++) {
            if (i >= count) {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
                continue;
            }
            try {
                JSONObject cat = cats.getJSONObject(i);
                String name = cat.optString("name", "");
                String icon = cat.optString("icon", "");
                double catSpent = cat.optDouble("spent", 0);
                int color;
                try {
                    color = Color.parseColor(cat.optString("color", "#F0B94D"));
                } catch (IllegalArgumentException badColor) {
                    color = Color.parseColor("#F0B94D");
                }

                views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
                views.setTextViewText(ICON_IDS[i], icon);
                views.setTextViewText(NAME_IDS[i], name);
                views.setTextViewText(AMOUNT_IDS[i], money((float) catSpent, currency));
                views.setTextColor(AMOUNT_IDS[i], color);
            } catch (JSONException e) {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
            }
        }

        if (count == 0) {
            // No spending logged yet this month — say so rather than leaving
            // an empty gap where the breakdown would be.
            views.setViewVisibility(ROW_IDS[0], View.VISIBLE);
            views.setTextViewText(ICON_IDS[0], "");
            views.setTextViewText(NAME_IDS[0], "No spending logged yet");
            views.setTextViewText(AMOUNT_IDS[0], "");
            for (int i = 1; i < ROW_IDS.length; i++) {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
            }
        }
    }

    private static void hideAllCategoryRows(RemoteViews views) {
        for (int rowId : ROW_IDS) {
            views.setViewVisibility(rowId, View.GONE);
        }
    }

    private static String money(float amount, String currency) {
        NumberFormat nf = NumberFormat.getNumberInstance(new Locale("en", "IN"));
        nf.setMaximumFractionDigits(0);
        return currency + nf.format(amount);
    }
}
