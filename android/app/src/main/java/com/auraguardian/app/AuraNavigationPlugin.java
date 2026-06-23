package com.auraguardian.app;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AuraNavigation")
public class AuraNavigationPlugin extends Plugin {

    @PluginMethod
    public void startWalkingNavigation(PluginCall call) {
        Double destinationLat = call.getDouble("destinationLat");
        Double destinationLng = call.getDouble("destinationLng");
        String destinationLabel = call.getString("destinationLabel", "Destination");
        Double originLat = call.getDouble("originLat");
        Double originLng = call.getDouble("originLng");

        if (destinationLat == null || destinationLng == null) {
            call.reject("destinationLat and destinationLng are required.");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable.");
            return;
        }

        Intent intent = new Intent(activity, MapboxNavigationActivity.class);
        intent.putExtra(MapboxNavigationActivity.EXTRA_DESTINATION_LAT, destinationLat);
        intent.putExtra(MapboxNavigationActivity.EXTRA_DESTINATION_LNG, destinationLng);
        intent.putExtra(MapboxNavigationActivity.EXTRA_DESTINATION_LABEL, destinationLabel);

        if (originLat != null && originLng != null) {
            intent.putExtra(MapboxNavigationActivity.EXTRA_ORIGIN_LAT, originLat);
            intent.putExtra(MapboxNavigationActivity.EXTRA_ORIGIN_LNG, originLng);
        }

        activity.startActivity(intent);

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopNavigation(PluginCall call) {
        MapboxNavigationActivity.finishIfRunning();

        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void isNavigationActive(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", MapboxNavigationActivity.isRunning());
        call.resolve(result);
    }
}
