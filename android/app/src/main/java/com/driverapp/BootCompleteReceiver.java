package com.webase.eazygodriver;  // ✅ Update this line

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootCompleteReceiver extends BroadcastReceiver {
    private static final String TAG = "BootCompleteReceiver";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "Device boot completed, restarting driver services");
        
        // Start background service after boot
        try {
            Intent serviceIntent = new Intent(context, BackgroundLocationService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            Log.d(TAG, "Background service started after boot");
        } catch (Exception e) {
            Log.e(TAG, "Error starting service after boot", e);
        }
    }
}