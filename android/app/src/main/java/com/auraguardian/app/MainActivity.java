package com.auraguardian.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private boolean volumeUpPressed = false;
	private boolean volumeDownPressed = false;
	private boolean volumeHoldArmed = false;
	private final Handler volumeHandler = new Handler(Looper.getMainLooper());

	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(AuraNavigationPlugin.class);
		super.onCreate(savedInstanceState);
	}

	private final Runnable volumeSosRunnable = new Runnable() {
		@Override
		public void run() {
			if (volumeUpPressed && volumeDownPressed) {
				volumeHoldArmed = false;
				Bridge bridge = getBridge();
				if (bridge != null) {
					bridge.triggerWindowJSEvent("auraguardianSos", "{\"trigger\":\"volume\"}");
				}
			}
		}
	};

	private void armVolumeHold() {
		if (volumeHoldArmed) return;
		volumeHoldArmed = true;
		volumeHandler.postDelayed(volumeSosRunnable, 3000);
	}

	private void cancelVolumeHold() {
		volumeHoldArmed = false;
		volumeHandler.removeCallbacks(volumeSosRunnable);
	}

	@Override
	public boolean onKeyDown(int keyCode, KeyEvent event) {
		if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
			volumeUpPressed = true;
		} else if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
			volumeDownPressed = true;
		}

		if (volumeUpPressed && volumeDownPressed) {
			armVolumeHold();
		}

		return super.onKeyDown(keyCode, event);
	}

	@Override
	public boolean onKeyUp(int keyCode, KeyEvent event) {
		if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
			volumeUpPressed = false;
		} else if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
			volumeDownPressed = false;
		}

		if (!volumeUpPressed || !volumeDownPressed) {
			cancelVolumeHold();
		}

		return super.onKeyUp(keyCode, event);
	}
}
