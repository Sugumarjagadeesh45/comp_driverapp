package com.webase.eazygodriver;  // ✅ Update this line

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;

public class BackgroundLocationService extends Service {
    private static final String TAG = "BackgroundLocationService";
    private static final int NOTIFICATION_ID = 1;
    private static final String CHANNEL_ID = "driver_location_service";
    
    private final IBinder binder = new LocalBinder();
    
    public class LocalBinder extends Binder {
        BackgroundLocationService getService() {
            return BackgroundLocationService.this;
        }
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Background Location Service Created");
        createNotificationChannel();
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "Background Location Service Started");
        
        // Create foreground notification
        Notification notification = createNotification();
        startForeground(NOTIFICATION_ID, notification);
        
        return START_STICKY;
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "Background Location Service Destroyed");
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                CHANNEL_ID,
                "Driver Location Service",
                NotificationManager.IMPORTANCE_HIGH
            );
            serviceChannel.setDescription("Keeps driver app running in background for ride requests");
            serviceChannel.setShowBadge(false);
            serviceChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
    
    private Notification createNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🚖 Eazy Go Driver")
            .setContentText("Online - Ready for ride requests")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }
}