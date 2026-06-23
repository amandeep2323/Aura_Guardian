package com.auraguardian.app;

import android.location.Location;
import android.os.Bundle;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.mapbox.api.directions.v5.DirectionsCriteria;
import com.mapbox.api.directions.v5.models.RouteOptions;
import com.mapbox.geojson.Point;
import com.mapbox.navigation.base.options.NavigationOptions;
import com.mapbox.navigation.base.route.NavigationRoute;
import com.mapbox.navigation.base.route.NavigationRouterCallback;
import com.mapbox.navigation.base.route.RouterFailure;
import com.mapbox.navigation.base.route.RouterOrigin;
import com.mapbox.navigation.core.MapboxNavigation;
import com.mapbox.navigation.core.lifecycle.MapboxNavigationApp;
import com.mapbox.navigation.core.trip.session.LocationMatcherResult;
import com.mapbox.navigation.core.trip.session.LocationObserver;
import com.mapbox.navigation.dropin.NavigationView;

import java.lang.ref.WeakReference;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class MapboxNavigationActivity extends AppCompatActivity {
    public static final String EXTRA_DESTINATION_LAT = "destinationLat";
    public static final String EXTRA_DESTINATION_LNG = "destinationLng";
    public static final String EXTRA_DESTINATION_LABEL = "destinationLabel";
    public static final String EXTRA_ORIGIN_LAT = "originLat";
    public static final String EXTRA_ORIGIN_LNG = "originLng";

    private static WeakReference<MapboxNavigationActivity> runningInstance = new WeakReference<>(null);

    @Nullable
    private NavigationView navigationView;
    @Nullable
    private Point destinationPoint;
    @Nullable
    private Point originHintPoint;
    @Nullable
    private Point lastEnhancedPoint;
    private boolean routeRequested = false;
    private boolean locationObserverRegistered = false;

    private final LocationObserver locationObserver = new LocationObserver() {
        @Override
        public void onNewRawLocation(Location rawLocation) {
            // We use map-matched enhanced location for better route snapping.
        }

        @Override
        public void onNewLocationMatcherResult(LocationMatcherResult locationMatcherResult) {
            Location enhancedLocation = locationMatcherResult.getEnhancedLocation();
            if (enhancedLocation == null) return;
            lastEnhancedPoint = Point.fromLngLat(enhancedLocation.getLongitude(), enhancedLocation.getLatitude());
            maybeRequestWalkingRoute();
        }
    };

    public static boolean isRunning() {
        MapboxNavigationActivity instance = runningInstance.get();
        return instance != null && !instance.isFinishing() && !instance.isDestroyed();
    }

    public static void finishIfRunning() {
        MapboxNavigationActivity instance = runningInstance.get();
        if (instance == null || instance.isFinishing() || instance.isDestroyed()) return;
        instance.runOnUiThread(instance::finish);
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        runningInstance = new WeakReference<>(this);
        setContentView(R.layout.activity_mapbox_navigation);

        navigationView = findViewById(R.id.mapboxNavigationView);

        String token = getString(R.string.mapbox_access_token);
        if (token == null || token.trim().isEmpty() || token.contains("YOUR_MAPBOX_PUBLIC_TOKEN")) {
            Toast.makeText(this, "Mapbox token missing. Set MAPBOX_ACCESS_TOKEN in android/gradle.properties.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        double destinationLat = getIntent().getDoubleExtra(EXTRA_DESTINATION_LAT, Double.NaN);
        double destinationLng = getIntent().getDoubleExtra(EXTRA_DESTINATION_LNG, Double.NaN);
        if (!Double.isFinite(destinationLat) || !Double.isFinite(destinationLng)) {
            Toast.makeText(this, "Destination missing.", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        destinationPoint = Point.fromLngLat(destinationLng, destinationLat);
        if (getIntent().hasExtra(EXTRA_ORIGIN_LAT) && getIntent().hasExtra(EXTRA_ORIGIN_LNG)) {
            double originLat = getIntent().getDoubleExtra(EXTRA_ORIGIN_LAT, Double.NaN);
            double originLng = getIntent().getDoubleExtra(EXTRA_ORIGIN_LNG, Double.NaN);
            if (Double.isFinite(originLat) && Double.isFinite(originLng)) {
                originHintPoint = Point.fromLngLat(originLng, originLat);
            }
        }

        if (!MapboxNavigationApp.isSetup()) {
            NavigationOptions navigationOptions = new NavigationOptions.Builder(getApplicationContext())
                .accessToken(token)
                .build();
            MapboxNavigationApp.setup(navigationOptions);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        MapboxNavigationApp.attach(this);
        registerLocationObserver();
        maybeRequestWalkingRoute();
    }

    @Override
    protected void onStop() {
        unregisterLocationObserver();
        MapboxNavigationApp.detach(this);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (runningInstance.get() == this) {
            runningInstance.clear();
        }
        super.onDestroy();
    }

    private void registerLocationObserver() {
        if (locationObserverRegistered) return;
        MapboxNavigation mapboxNavigation = MapboxNavigationApp.current();
        if (mapboxNavigation == null) return;
        mapboxNavigation.registerLocationObserver(locationObserver);
        locationObserverRegistered = true;
    }

    private void unregisterLocationObserver() {
        if (!locationObserverRegistered) return;
        MapboxNavigation mapboxNavigation = MapboxNavigationApp.current();
        if (mapboxNavigation != null) {
            mapboxNavigation.unregisterLocationObserver(locationObserver);
        }
        locationObserverRegistered = false;
    }

    private void maybeRequestWalkingRoute() {
        if (routeRequested || destinationPoint == null || navigationView == null) return;

        Point originPoint = originHintPoint != null ? originHintPoint : lastEnhancedPoint;
        if (originPoint == null) return;

        MapboxNavigation mapboxNavigation = MapboxNavigationApp.current();
        if (mapboxNavigation == null) return;

        routeRequested = true;
        RouteOptions routeOptions = RouteOptions.builder()
            .coordinatesList(Arrays.asList(originPoint, destinationPoint))
            .profile(DirectionsCriteria.PROFILE_WALKING)
            .steps(true)
            .voiceInstructions(true)
            .bannerInstructions(true)
            .overview(DirectionsCriteria.OVERVIEW_FULL)
            .language(Locale.getDefault().toLanguageTag())
            .voiceUnits(resolveVoiceUnits())
            .alternatives(false)
            .build();

        mapboxNavigation.requestRoutes(routeOptions, new NavigationRouterCallback() {
            @Override
            public void onRoutesReady(List<NavigationRoute> routes, RouterOrigin routerOrigin) {
                if (routes == null || routes.isEmpty()) {
                    routeRequested = false;
                    showShortToast("No walking route found.");
                    return;
                }

                if (navigationView != null) {
                    navigationView.getApi().startActiveGuidance(routes);
                }
            }

            @Override
            public void onFailure(List<RouterFailure> reasons, RouteOptions routeOptions) {
                routeRequested = false;
                showShortToast("Failed to load walking route.");
            }

            @Override
            public void onCanceled(RouteOptions routeOptions, RouterOrigin routerOrigin) {
                routeRequested = false;
            }
        });
    }

    private String resolveVoiceUnits() {
        String country = Locale.getDefault().getCountry();
        boolean useImperial = "US".equalsIgnoreCase(country)
            || "LR".equalsIgnoreCase(country)
            || "MM".equalsIgnoreCase(country);
        return useImperial ? DirectionsCriteria.IMPERIAL : DirectionsCriteria.METRIC;
    }

    private void showShortToast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
    }
}
