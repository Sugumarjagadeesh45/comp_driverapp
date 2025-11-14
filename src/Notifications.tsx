// Notifications.tsx
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging from '@react-native-firebase/messaging';
import notifee, { 
  AndroidImportance, 
  AndroidStyle, 
  AndroidVisibility 
} from '@notifee/react-native';

class NotificationService {
  private static instance: NotificationService;
  private listeners: Map<string, Function[]> = new Map();
  private fcmToken: string | null = null;
  private notificationInitialized = false;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  // Initialize notification system
  async initializeNotifications() {
    try {
      console.log('🔔 Setting up complete notification system...');
      
      // Request permissions using Firebase's method
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        console.log('❌ Notification permission not granted');
        return false;
      }

      // Create notification channel (Android)
      await this.createNotificationChannel();
      
      // Get FCM token
      await this.getFCMToken();
      
      // Setup all handlers
      this.setupForegroundHandler();
      this.setupBackgroundHandler();
      this.setupTokenRefreshHandler();
      
      // Check for pending notifications
      await this.checkPendingNotifications();
      
      this.notificationInitialized = true;
      console.log('✅ Notification system initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Error in notification system initialization:', error);
      return false;
    }
  }

  // Create notification channel with proper configuration
  async createNotificationChannel() {
    if (Platform.OS === 'android') {
      try {
        await notifee.createChannel({
          id: 'high_priority_channel',
          name: 'Ride Requests',
          importance: AndroidImportance.HIGH,
          sound: 'default',
          vibration: true,
          vibrationPattern: [300, 500, 300, 500, 300, 500],
          lights: true,
          lightColor: '#FF6B35',
          bypassDnd: true, // Bypass Do Not Disturb
          visibility: AndroidVisibility.PUBLIC, // Show on lock screen
          badge: true,
        });
        console.log('✅ Android notification channel created with high priority');
      } catch (error) {
        console.error('❌ Error creating notification channel:', error);
      }
    }
  }

  // Setup foreground message handler
  setupForegroundHandler() {
    try {
      console.log('📱 Setting up foreground message handler...');
      
      messaging().onMessage(async remoteMessage => {
        console.log('📱 🔵 FOREGROUND FCM message received:', remoteMessage);
        
        // Show local notification with proper data mapping
        await this.showLocalNotification({
          title: remoteMessage.notification?.title || '🚖 New Ride Request',
          body: remoteMessage.notification?.body || 'Tap to view ride details',
          data: remoteMessage.data
        });

        // Emit event for app to handle
        if (remoteMessage.data?.type === 'ride_request') {
          console.log('📱 Emitting rideRequest event from foreground');
          this.emit('rideRequest', remoteMessage.data);
        }
      });

      console.log('✅ Foreground message handler registered');
    } catch (error) {
      console.error('❌ Error setting up foreground handler:', error);
    }
  }

  // Setup background handler
  async setupBackgroundHandler() {
    try {
      console.log('📱 Setting up RELIABLE background/quit state handler...');
      
      // Handle background/quit state messages
      messaging().setBackgroundMessageHandler(async remoteMessage => {
        console.log('📱 🟢 BACKGROUND/QUIT FCM RECEIVED:', remoteMessage?.data);
        
        // Show notification immediately in background
        await this.showLocalNotification({
          title: remoteMessage?.data?.title || '🚖 New Ride Request',
          body: remoteMessage?.data?.body || 'Tap to view ride details',
          data: remoteMessage?.data
        });

        // Store for when app opens
        if (remoteMessage?.data?.type === 'ride_request') {
          await AsyncStorage.setItem('pendingRideRequest', JSON.stringify(remoteMessage.data));
          console.log('💾 Saved pending ride request for app open');
        }
        
        return Promise.resolve();
      });

    } catch (error) {
      console.error('❌ Background handler setup failed:', error);
    }
  }

  // Show local notification with enhanced configuration
  async showLocalNotification(notification: {
    title: string;
    body: string;
    data?: any;
  }) {
    try {
      console.log('🔔 Displaying HIGH PRIORITY notification:', notification.title);
      
      await notifee.displayNotification({
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        android: {
          channelId: 'high_priority_channel',
          smallIcon: 'ic_launcher',
          color: '#FF6B35',
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          sound: 'default',
          vibrationPattern: [300, 500, 300, 500, 300, 500],
          lights: ['#FF6B35', 300, 1000],
          importance: AndroidImportance.HIGH,
          priority: 'high',
        },
        ios: {
          categoryId: 'ride_request',
          sound: 'default',
          critical: true,
          criticalVolume: 1.0,
        },
      });
      
      console.log('✅ HIGH PRIORITY notification displayed');
    } catch (error) {
      console.error('❌ Error showing high priority notification:', error);
      // Fallback: Try with minimal configuration
      try {
        await notifee.displayNotification({
          title: notification.title,
          body: notification.body,
          data: notification.data,
          android: {
            channelId: 'high_priority_channel',
          },
        });
        console.log('✅ Fallback notification displayed');
      } catch (fallbackError) {
        console.error('❌ Fallback notification also failed:', fallbackError);
      }
    }
  }

  // Get FCM token with modern approach
  async getFCMToken(): Promise<string | null> {
    try {
      console.log('🔑 Getting FCM token...');
      
      // Modern approach - remove deprecated method calls
      try {
        // For React Native Firebase v17+, just get the token directly
        const token = await messaging().getToken();
        
        if (token) {
          this.fcmToken = token;
          console.log('✅ FCM Token obtained:', token.substring(0, 20) + '...');
          
          await AsyncStorage.setItem('fcmToken', token);
          return token;
        } else {
          console.log('❌ No FCM token received');
          return null;
        }
      } catch (firebaseError) {
        console.error('❌ Firebase messaging error:', firebaseError);
        
        // Fallback: Try alternative method
        try {
          const fallbackToken = await messaging().getToken();
          if (fallbackToken) {
            this.fcmToken = fallbackToken;
            console.log('✅ FCM Token obtained (fallback):', fallbackToken.substring(0, 20) + '...');
            await AsyncStorage.setItem('fcmToken', fallbackToken);
            return fallbackToken;
          }
        } catch (fallbackError) {
          console.error('❌ Fallback token method also failed:', fallbackError);
        }
        
        return null;
      }
    
    } catch (error) {
      console.error('❌ Error getting FCM token:', error);
      return null;
    }
  }

  // Setup token refresh handler
  setupTokenRefreshHandler() {
    try {
      messaging().onTokenRefresh(async (newToken) => {
        console.log('🔄 FCM token refreshed:', newToken.substring(0, 20) + '...');
        
        // Update token in backend
        try {
          const authToken = await AsyncStorage.getItem("authToken");
          if (authToken) {
            const response = await fetch(`${API_BASE}/drivers/update-fcm-token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({
                fcmToken: newToken,
                platform: Platform.OS
              }),
            });
            
            if (response.ok) {
              const result = await response.json();
              console.log('✅ FCM token updated on server:', result);
            } else {
              console.log('❌ Server error:', response.status);
            }
          }
        } catch (error) {
          console.error('❌ Error updating FCM token:', error);
        }
        
        // Emit event for app to handle
        this.emit('tokenRefresh', newToken);
      });
    } catch (error) {
      console.error('❌ Error setting up token refresh handler:', error);
    }
  }

  // Event emitter methods
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    console.log(`✅ Registered listener for: ${event}`);
  }

  off(event: string, callback: Function) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)!;
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any) {
    if (this.listeners.has(event)) {
      console.log(`📢 Emitting event: ${event}`, data);
      this.listeners.get(event)!.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`❌ Error in ${event} listener:`, error);
        }
      });
    }
  }

  // Check for pending notifications
  async checkPendingNotifications() {
    try {
      console.log('🔍 Checking for pending notifications...');

      // Check for initial notification (app opened from quit state)
      const initialNotification = await notifee.getInitialNotification();
      if (initialNotification) {
        console.log('📱 App opened from QUIT state by notification:', initialNotification);
        
        if (initialNotification.notification.data?.type === 'ride_request') {
          console.log('📱 Processing ride request from quit state');
          setTimeout(() => {
            this.emit('rideRequest', initialNotification.notification.data);
          }, 3000);
        }
      }

      // Listen for notification opened from background
      notifee.onForegroundEvent(({ type, detail }) => {
        if (type === 'press' && detail.notification) {
          console.log('📱 Notification opened from BACKGROUND:', detail.notification);
          
          if (detail.notification.data?.type === 'ride_request') {
            this.emit('rideRequest', detail.notification.data);
          }
        }
      });

    } catch (error) {
      console.error('❌ Error checking pending notifications:', error);
    }
  }

  // Setup FCM completely
  async setupFCM(): Promise<boolean> {
    return await this.initializeNotifications();
  }

  // Test notification method
  async testNotification() {
    await this.showLocalNotification({
      title: 'Test Notification',
      body: 'This is a test notification from the app',
      data: { test: true }
    });
  }
}

export default NotificationService.getInstance();



// // D:\app\dr_app-main\dr_app-main\src\Notifications.tsx
// import { Platform, AppState } from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import messaging from '@react-native-firebase/messaging';
// // ✅ FIXED IMPORT - Add AndroidVisibility
// import notifee, { 
//   AndroidImportance, 
//   AndroidStyle, 
//   AndroidVisibility  // ✅ ADD THIS
// } from '@notifee/react-native';

// class NotificationService {
//   private static instance: NotificationService;
//   private listeners: Map<string, Function[]> = new Map();
//   private fcmToken: string | null = null;
//   private notificationInitialized = false;

//   static getInstance(): NotificationService {
//     if (!NotificationService.instance) {
//       NotificationService.instance = new NotificationService();
//     }
//     return NotificationService.instance;
//   }

//   // ✅ FIXED: Initialize complete notification system
//   async initializeNotifications() {
//     try {
//       if (this.notificationInitialized) {
//         console.log('🔔 Notifications already initialized');
//         return true;
//       }

//       console.log('🔔 Initializing complete notification system...');
      
//       // Request permissions
//       const hasPermission = await this.requestNotificationPermission();
//       if (!hasPermission) {
//         console.log('❌ Notification permission not granted');
//         return false;
//       }

//       // Create notification channel (Android) - ✅ FIXED
//       await this.createNotificationChannel();
      
//       // Get FCM token
//       await this.getFCMToken();
      
//       // Setup all handlers
//       this.setupForegroundHandler();
//       this.setupBackgroundHandler();
//       this.setupTokenRefreshHandler();
      
//       // Check for pending notifications
//       await this.checkPendingNotifications();
      
//       this.notificationInitialized = true;
//       console.log('✅ Notification system initialized successfully');
//       return true;
//     } catch (error) {
//       console.error('❌ Error initializing notifications:', error);
//       return false;
//     }
//   }

//   // ✅ FIXED: Create notification channel with proper configuration
//   async createNotificationChannel() {
//     if (Platform.OS === 'android') {
//       try {
//         await notifee.createChannel({
//           id: 'high_priority_channel',
//           name: 'Ride Requests',
//           importance: AndroidImportance.HIGH,
//           sound: 'default',
//           vibration: true,
//           vibrationPattern: [300, 500, 300, 500, 300, 500],
//           lights: true,
//           lightColor: '#FF6B35',
//           bypassDnd: true, // Bypass Do Not Disturb
//           visibility: AndroidVisibility.PUBLIC, // ✅ FIXED: Show on lock screen
//           badge: true,
//         });
//         console.log('✅ Android notification channel created with high priority');
//       } catch (error) {
//         console.error('❌ Error creating notification channel:', error);
//       }
//     }
//   }

  
//   // ✅ FIXED: Simplified permission request
// async requestNotificationPermission(): Promise<boolean> {
//   try {
//     console.log('📱 Requesting notification permission...');
    
//     if (Platform.OS === 'android') {
//       // For Android, use notifee for permissions
//       const settings = await notifee.requestPermission();
//       console.log('📱 Android permission result:', settings);
//       return settings.authorizationStatus >= 1;
//     } else {
//       // For iOS, use Firebase messaging
//       const authStatus = await messaging().requestPermission();
//       const enabled = 
//         authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
//         authStatus === messaging.AuthorizationStatus.PROVISIONAL;
//       console.log('📱 iOS permission result:', authStatus, 'Enabled:', enabled);
//       return enabled;
//     }
//   } catch (error) {
//     console.error('❌ Error requesting notification permission:', error);
//     // Don't block the app if permission fails
//     return true;
//   }
// }
  
//   // ✅ FIXED: Modern FCM token retrieval
// async getFCMToken(): Promise<string | null> {
//   try {
//     console.log('🔑 Getting FCM token...');
    
//     // Modern approach - remove deprecated method calls
//     try {
//       // For React Native Firebase v17+, just get the token directly
//       const token = await messaging().getToken();
      
//       if (token) {
//         this.fcmToken = token;
//         console.log('✅ FCM Token obtained:', token.substring(0, 20) + '...');
        
//         await AsyncStorage.setItem('fcmToken', token);
//         return token;
//       } else {
//         console.log('❌ No FCM token received');
//         return null;
//       }
//     } catch (firebaseError) {
//       console.error('❌ Firebase messaging error:', firebaseError);
      
//       // Fallback: Try alternative method
//       try {
//         const fallbackToken = await messaging().getToken();
//         if (fallbackToken) {
//           this.fcmToken = fallbackToken;
//           console.log('✅ FCM Token obtained (fallback):', fallbackToken.substring(0, 20) + '...');
//           await AsyncStorage.setItem('fcmToken', fallbackToken);
//           return fallbackToken;
//         }
//       } catch (fallbackError) {
//         console.error('❌ Fallback token method also failed:', fallbackError);
//       }
      
//       return null;
//     }
    
//   } catch (error) {
//     console.error('❌ Error getting FCM token:', error);
//     return null;
//   }
// }


//   // ✅ FIXED: Setup foreground message handler
//   setupForegroundHandler() {
//     try {
//       console.log('📱 Setting up foreground message handler...');

//       messaging().onMessage(async remoteMessage => {
//         console.log('📱 🔵 FOREGROUND FCM message received:', remoteMessage);
        
//         // ✅ FIXED: Show local notification with proper data mapping
//         await this.showLocalNotification({
//           title: remoteMessage.notification?.title || '🚖 New Ride Request',
//           body: remoteMessage.notification?.body || 'Tap to view ride details',
//           data: remoteMessage.data
//         });

//         // Emit event for app to handle
//         if (remoteMessage.data?.type === 'ride_request') {
//           console.log('📱 Emitting rideRequest event from foreground');
//           this.emit('rideRequest', remoteMessage.data);
//         }
//       });

//       console.log('✅ Foreground message handler registered');
//     } catch (error) {
//       console.error('❌ Error setting up foreground handler:', error);
//     }
//   }

//   // ✅ FIXED: Background handler
//   async setupBackgroundHandler() {
//     try {
//       console.log('📱 Setting up RELIABLE background/quit state handler...');

//       // Handle background/quit state messages
//       messaging().setBackgroundMessageHandler(async remoteMessage => {
//         console.log('📱 🟢 BACKGROUND/QUIT FCM RECEIVED:', remoteMessage?.data);
        
//         // ✅ FIXED: Show notification immediately in background
//         await this.showLocalNotification({
//           title: remoteMessage?.data?.title || '🚖 New Ride Request',
//           body: remoteMessage?.data?.body || 'Tap to view ride details',
//           data: remoteMessage?.data
//         });

//         // Store for when app opens
//         if (remoteMessage?.data?.type === 'ride_request') {
//           await AsyncStorage.setItem('pendingRideRequest', JSON.stringify(remoteMessage.data));
//           console.log('💾 Saved pending ride request for app open');
//         }
        
//         return Promise.resolve();
//       });

//     } catch (error) {
//       console.error('❌ Background handler setup failed:', error);
//     }
//   }

//   // ✅ FIXED: Enhanced local notification with proper icon
//   async showLocalNotification(notification: {
//     title: string;
//     body: string;
//     data?: any;
//   }) {
//     try {
//       console.log('🔔 Displaying HIGH PRIORITY notification:', notification.title);
      
//       await notifee.displayNotification({
//         title: notification.title,
//         body: notification.body,
//         data: notification.data || {},
//         android: {
//           channelId: 'high_priority_channel',
//           smallIcon: 'ic_launcher', // ✅ FIXED: Use launcher icon if notification icon missing
//           color: '#FF6B35',
//           pressAction: {
//             id: 'default',
//             launchActivity: 'default',
//           },
//           sound: 'default',
//           vibrationPattern: [300, 500, 300, 500, 300, 500],
//           lights: ['#FF6B35', 300, 1000],
//           importance: AndroidImportance.HIGH,
//           priority: 'high',
//         },
//         ios: {
//           categoryId: 'ride_request',
//           sound: 'default',
//           critical: true,
//           criticalVolume: 1.0,
//         },
//       });
      
//       console.log('✅ HIGH PRIORITY notification displayed');
//     } catch (error) {
//       console.error('❌ Error showing high priority notification:', error);
//       // Fallback: Try with minimal configuration
//       try {
//         await notifee.displayNotification({
//           title: notification.title,
//           body: notification.body,
//           data: notification.data,
//           android: {
//             channelId: 'high_priority_channel',
//           },
//         });
//         console.log('✅ Fallback notification displayed');
//       } catch (fallbackError) {
//         console.error('❌ Fallback notification also failed:', fallbackError);
//       }
//     }
//   }

//   // Setup token refresh handler
//   setupTokenRefreshHandler() {
//     try {
//       messaging().onTokenRefresh(async (token) => {
//         console.log('🔄 FCM token refreshed:', token.substring(0, 20) + '...');
//         this.fcmToken = token;
//         await AsyncStorage.setItem('fcmToken', token);
//         this.emit('tokenRefresh', token);
//       });
      
//       console.log('✅ Token refresh handler registered');
//     } catch (error) {
//       console.error('❌ Error setting up token refresh handler:', error);
//     }
//   }

//   // Check for pending notifications
//   async checkPendingNotifications() {
//     try {
//       console.log('🔍 Checking for pending notifications...');

//       // Check for initial notification (app opened from quit state)
//       const initialNotification = await notifee.getInitialNotification();
//       if (initialNotification) {
//         console.log('📱 App opened from QUIT state by notification:', initialNotification);
        
//         if (initialNotification.notification.data?.type === 'ride_request') {
//           console.log('📱 Processing ride request from quit state');
//           setTimeout(() => {
//             this.emit('rideRequest', initialNotification.notification.data);
//           }, 3000);
//         }
//       }

//       // Listen for notification opened from background
//       notifee.onForegroundEvent(({ type, detail }) => {
//         if (type === 'press' && detail.notification) {
//           console.log('📱 Notification opened from BACKGROUND:', detail.notification);
          
//           if (detail.notification.data?.type === 'ride_request') {
//             this.emit('rideRequest', detail.notification.data);
//           }
//         }
//       });

//     } catch (error) {
//       console.error('❌ Error checking pending notifications:', error);
//     }
//   }

//   // Event emitter methods
//   on(event: string, callback: Function) {
//     if (!this.listeners.has(event)) {
//       this.listeners.set(event, []);
//     }
//     this.listeners.get(event)!.push(callback);
//     console.log(`✅ Registered listener for: ${event}`);
//   }

//   off(event: string, callback: Function) {
//     if (this.listeners.has(event)) {
//       const callbacks = this.listeners.get(event)!;
//       const index = callbacks.indexOf(callback);
//       if (index > -1) {
//         callbacks.splice(index, 1);
//       }
//     }
//   }

//   private emit(event: string, data: any) {
//     if (this.listeners.has(event)) {
//       console.log(`📢 Emitting event: ${event}`, data);
//       this.listeners.get(event)!.forEach(callback => {
//         try {
//           callback(data);
//         } catch (error) {
//           console.error(`❌ Error in ${event} listener:`, error);
//         }
//       });
//     }
//   }

//   // Get current FCM token
//   getCurrentToken(): string | null {
//     return this.fcmToken;
//   }

//   // ✅ FIXED: Check FCM token method
// async checkFCMToken(): Promise<string | null> {
//   try {
//     // First, try to get from storage
//     const storedToken = await AsyncStorage.getItem('fcmToken');
//     if (storedToken) {
//       console.log('📱 Using stored FCM token');
//       this.fcmToken = storedToken;
//       return storedToken;
//     }
    
//     // If no stored token, get a new one
//     console.log('📱 No stored token, getting new FCM token...');
//     return await this.getFCMToken();
//   } catch (error) {
//     console.error('❌ Error checking FCM token:', error);
//     return null;
//   }
// }
//   // Setup notifications (alias for initializeNotifications)
//   async setupNotifications(): Promise<boolean> {
//     return await this.initializeNotifications();
//   }

//   // Setup FCM completely
//   async setupFCM(): Promise<boolean> {
//     return await this.initializeNotifications();
//   }

//   // Test notification method
//   async testNotification() {
//     await this.showLocalNotification({
//       title: 'Test Notification',
//       body: 'This is a test notification from the app',
//       data: { test: true }
//     });
//   }
// }

// export default NotificationService.getInstance();