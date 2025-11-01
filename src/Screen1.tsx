// D:\app\perDRIV-main\perDRIV-main\src\Screen1.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Alert,
  Modal,
  TextInput,
  Dimensions,
  AppState,
  Linking,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import Geolocation from "@react-native-community/geolocation";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "./apiConfig";
import api from "../utils/api";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import FontAwesome from "react-native-vector-icons/FontAwesome";
import BackgroundTimer from 'react-native-background-timer';

// Import the NotificationService
import NotificationService from './Notifications'; 

const { width, height } = Dimensions.get("window");

type LocationType = { latitude: number; longitude: number };
type RideType = {
  rideId: string;
  RAID_ID?: string;
  otp?: string;
  pickup: LocationType & { address?: string };
  drop: LocationType & { address?: string };
  routeCoords?: LocationType[];
  fare?: number;
  distance?: string;
  userName?: string;
  userMobile?: string;
};
type UserDataType = {
  name: string;
  mobile: string;
  location: LocationType;
  userId?: string;
};

const DriverScreen = ({ route, navigation }: { route: any; navigation: any }) => {
  const [location, setLocation] = useState<LocationType | null>(
    route.params?.latitude && route.params?.longitude
      ? { latitude: route.params.latitude, longitude: route.params.longitude }
      : null
  );
  const [ride, setRide] = useState<RideType | null>(null);
  const [userData, setUserData] = useState<UserDataType | null>(null);
  const [userLocation, setUserLocation] = useState<LocationType | null>(null);
  const [travelledKm, setTravelledKm] = useState(0);
  const [lastCoord, setLastCoord] = useState<LocationType | null>(null);
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [enteredOtp, setEnteredOtp] = useState("");
  const [rideStatus, setRideStatus] = useState<
    "idle" | "onTheWay" | "accepted" | "started" | "completed"
  >("idle");
  const [isRegistered, setIsRegistered] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [driverStatus, setDriverStatus] = useState<
    "offline" | "online" | "onRide"
  >("offline");
  const [isLoading, setIsLoading] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const [driverId, setDriverId] = useState<string>(route.params?.driverId || "");
  const [driverName, setDriverName] = useState<string>(
    route.params?.driverName || ""
  );
  const [error, setError] = useState<string | null>(null);
  
  // Route handling states
  const [fullRouteCoords, setFullRouteCoords] = useState<LocationType[]>([]);
  const [visibleRouteCoords, setVisibleRouteCoords] = useState<LocationType[]>([]);
  const [nearestPointIndex, setNearestPointIndex] = useState(0);
  const [mapRegion, setMapRegion] = useState<any>(null);
  
  // New states for verification and bill
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [billDetails, setBillDetails] = useState({
    distance: '0 km',
    travelTime: '0 mins',
    charge: 0,
    userName: '',
    userMobile: ''
  });
  const [verificationDetails, setVerificationDetails] = useState({
    pickup: '',
    dropoff: '',
    time: '',
    speed: 0,
    distance: 0,
  });
  const [otpSharedTime, setOtpSharedTime] = useState<Date | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);

  // 🆕 NEW: Online/Offline toggle state
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [backgroundTrackingActive, setBackgroundTrackingActive] = useState(false);
  
  // 🆕 FCM Notification states
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
  const [isBackgroundMode, setIsBackgroundMode] = useState(false);

  // Refs for optimization
  const isMounted = useRef(true);
  const locationUpdateCount = useRef(0);
  const mapAnimationInProgress = useRef(false);
  const navigationInterval = useRef<NodeJS.Timeout | null>(null);
  const lastLocationUpdate = useRef<LocationType | null>(null);
  const routeUpdateThrottle = useRef<NodeJS.Timeout | null>(null);
  const distanceSinceOtp = useRef(0);
  const lastLocationBeforeOtp = useRef<LocationType | null>(null);
  const appState = useRef(AppState.currentState);
  const geolocationWatchId = useRef<number | null>(null);
  const backgroundLocationInterval = useRef<NodeJS.Timeout | null>(null);

  // Socket import
  let socket: any = null;
  try {
    socket = require("./socket").default;
  } catch (error) {
    console.warn("⚠️ Socket not available:", error);
  }

  // Haversine distance function
  const haversine = (start: LocationType, end: LocationType) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (end.latitude - start.latitude) * Math.PI / 180;
    const dLon = (end.longitude - start.longitude) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(start.latitude * Math.PI / 180) * Math.cos(end.latitude * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c * 1000; // Distance in meters
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (navigationInterval.current) {
        clearInterval(navigationInterval.current);
      }
      if (routeUpdateThrottle.current) {
        clearTimeout(routeUpdateThrottle.current);
      }
      if (geolocationWatchId.current) {
        Geolocation.clearWatch(geolocationWatchId.current);
      }
      if (backgroundLocationInterval.current) {
        clearInterval(backgroundLocationInterval.current);
      }
      // Clean up notification listeners
      NotificationService.off('rideRequest', handleNotificationRideRequest);
      NotificationService.off('tokenRefresh', () => {});
    };
  }, []);

  // 🆕 NEW: Socket connect/disconnect based on online status
  useEffect(() => {
    if (socket) {
      if (isDriverOnline) {
        console.log("🔌 Connecting socket for online driver");
        socket.connect();
      } else {
        console.log("🔌 Disconnecting socket for offline driver");
        socket.disconnect();
      }
    }
  }, [isDriverOnline]);

  // 🆕 Background location tracking with regular geolocation
  const startBackgroundLocationTracking = useCallback(() => {
    console.log("🔄 Starting background location tracking");
    
    // Stop any existing tracking
    if (geolocationWatchId.current) {
      Geolocation.clearWatch(geolocationWatchId.current);
    }
    
    // Start high-frequency tracking when online
    geolocationWatchId.current = Geolocation.watchPosition(
      (position) => {
        if (!isMounted.current || !isDriverOnline) return;
        
        const newLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        
        console.log("📍 Location update:", newLocation);
        setLocation(newLocation);
        setCurrentSpeed(position.coords.speed || 0);
        
        // Update distance if ride is active
        if (lastCoord && (rideStatus === "accepted" || rideStatus === "started")) {
          const dist = haversine(lastCoord, newLocation);
          const distanceKm = dist / 1000;
          setTravelledKm((prev) => prev + distanceKm);
          
          if (rideStatus === "started" && lastLocationBeforeOtp.current) {
            distanceSinceOtp.current += distanceKm;
          }
        }
        
        setLastCoord(newLocation);
        lastLocationUpdate.current = newLocation;
        
        // Send to server and socket
        saveLocationToDatabase(newLocation);
      },
      (error) => {
        console.error("❌ Geolocation error:", error);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 5, // 5 meters
        interval: 3000, // 3 seconds
        fastestInterval: 2000, // 2 seconds
      }
    );
    
    setBackgroundTrackingActive(true);
  }, [isDriverOnline, lastCoord, rideStatus]);

  // 🆕 Stop background location tracking
  const stopBackgroundLocationTracking = useCallback(() => {
    console.log("🛑 Stopping background location tracking");
    
    if (geolocationWatchId.current) {
      Geolocation.clearWatch(geolocationWatchId.current);
      geolocationWatchId.current = null;
    }
    
    if (backgroundLocationInterval.current) {
      clearInterval(backgroundLocationInterval.current);
      backgroundLocationInterval.current = null;
    }
    
    setBackgroundTrackingActive(false);
  }, []);

  // 🆕 Handle app state changes for background tracking
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'background' && isDriverOnline) {
        console.log("📱 App in background, maintaining location tracking");
        setIsBackgroundMode(true);
      } else if (nextAppState === 'active' && isDriverOnline) {
        console.log("📱 App in foreground");
        setIsBackgroundMode(false);
        // Check for pending notifications when app comes to foreground
        NotificationService.checkPendingNotifications();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [isDriverOnline]);

  // 🆕 FCM: Initialize notification system
  useEffect(() => {
    const initializeNotificationSystem = async () => {
      try {
        console.log('🔔 Setting up complete notification system...');
        
        // Initialize the notification service
        const initialized = await NotificationService.initializeNotifications();
        
        if (initialized) {
          console.log('✅ Notification system initialized successfully');
          
          // Get FCM token and send to server
          const token = await NotificationService.getFCMToken();
          if (token && driverId) {
            await sendFCMTokenToServer(token);
          }
          
          // Listen for ride requests
          NotificationService.on('rideRequest', handleNotificationRideRequest);
          
          // Listen for token refresh
          NotificationService.on('tokenRefresh', async (newToken) => {
            console.log('🔄 FCM token refreshed, updating server...');
            if (driverId) {
              await sendFCMTokenToServer(newToken);
            }
          });
          
          setHasNotificationPermission(true);
        } else {
          console.log('❌ Notification system initialization failed');
          setHasNotificationPermission(false);
        }
      } catch (error) {
        console.error('❌ Error in notification system initialization:', error);
        // Don't block the app if notifications fail
        setHasNotificationPermission(false);
      }
    };

    // Initialize when driver goes online
    if ((driverStatus === 'online' || driverStatus === 'onRide') && !hasNotificationPermission) {
      initializeNotificationSystem();
    }

    return () => {
      // Cleanup
      NotificationService.off('rideRequest', handleNotificationRideRequest);
    };
  }, [driverStatus, driverId, hasNotificationPermission]);

  // 🆕 FCM: Send token to server
  const sendFCMTokenToServer = async (token: string): Promise<boolean> => {
    try {
      const authToken = await AsyncStorage.getItem("authToken");
      if (!authToken) {
        console.log('❌ No auth token available');
        return false;
      }

      console.log('📤 Sending FCM token to server...');
      
      // Use the correct endpoint - adjust as per your backend
      const response = await fetch(`${API_BASE}/api/drivers/update-fcm-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          driverId: driverId,
          fcmToken: token,
          platform: Platform.OS
        }),
      });
      
      console.log('📡 Response status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ FCM token updated on server:', result);
        return true;
      } else {
        const errorText = await response.text();
        console.log('❌ Server error:', response.status, errorText);
        return false;
      }
    } catch (error) {
      console.error('❌ Network error sending token:', error);
      return false;
    }
  };

  // 🆕 FCM: Handle notification ride request
  const handleNotificationRideRequest = (data: any) => {
    console.log('📱 Received ride request via notification:', data);
    
    if (!data || data.type !== 'ride_request') {
      console.error('Invalid ride request payload:', data);
      return;
    }
    
    const rideData: RideType = {
      rideId: data.rideId,
      RAID_ID: data.RAID_ID || "N/A",
      otp: data.otp || "0000",
      pickup: {
        latitude: data.pickup?.lat || data.pickup?.latitude || 0,
        longitude: data.pickup?.lng || data.pickup?.longitude || 0,
        address: data.pickup?.address || "Unknown location",
      },
      drop: {
        latitude: data.drop?.lat || data.drop?.latitude || 0,
        longitude: data.drop?.lng || data.drop?.longitude || 0,
        address: data.drop?.address || "Unknown location",
      },
      fare: data.fare || 0,
      distance: data.distance || "0 km",
      userName: data.userName || data.customerName || "Customer",
      userMobile: data.userMobile || "N/A",
    };
    
    console.log('📱 Processed ride data:', rideData);
    handleRideRequest(rideData);
  };

  // 🆕 FCM: Test notification function
  const testNotification = async () => {
    try {
      console.log('🧪 Testing notification...');
      await NotificationService.testNotification();
      Alert.alert('Test', 'Notification test triggered');
    } catch (error) {
      console.error('Test notification failed:', error);
      Alert.alert('Test Failed', 'Could not show test notification');
    }
  };

  // 🆕 Toggle Online/Offline Status
  const toggleOnlineStatus = async () => {
    try {
      if (!isDriverOnline) {
        // Going ONLINE
        console.log("🟢 Driver going ONLINE - Starting location tracking");
        
        // Request permissions first
        if (Platform.OS === "android") {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: "Location Permission",
              message: "This app needs access to your location for ride tracking",
              buttonNeutral: "Ask Me Later",
              buttonNegative: "Cancel",
              buttonPositive: "OK"
            }
          );
          
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert("Permission Required", "Location permission is required to go online");
            return;
          }
        }

        // Get current location first
        Geolocation.getCurrentPosition(
          async (pos) => {
            const currentLoc = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            };
            
            setLocation(currentLoc);
            setLastCoord(currentLoc);

            // Initialize FCM before starting tracking
            console.log('🔔 Initializing FCM...');
            try {
              const initialized = await NotificationService.initializeNotifications();
              if (initialized) {
                const token = await NotificationService.getFCMToken();
                if (token) {
                  await sendFCMTokenToServer(token);
                }
                // Set up listeners
                NotificationService.on('rideRequest', handleNotificationRideRequest);
                NotificationService.on('tokenRefresh', async (newToken) => {
                  console.log('🔄 FCM token refreshed, updating server...');
                  await sendFCMTokenToServer(newToken);
                });
                setHasNotificationPermission(true);
                console.log('✅ FCM initialized');
              }
            } catch (error) {
              console.warn('⚠️ FCM initialization failed:', error);
            }

            // Start background tracking
            startBackgroundLocationTracking();

            // Set states (this will trigger socket connect via useEffect)
            setIsDriverOnline(true);
            setDriverStatus("online");

            // Save online status
            await AsyncStorage.setItem("driverOnlineStatus", "online");

            Alert.alert("✅ Online", "You are now online and ready to accept rides");
          },
          (error) => {
            console.error("❌ Error getting location:", error);
            Alert.alert("Error", "Failed to get your location. Please check GPS settings.");
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );

      } else {
        // Going OFFLINE
        console.log("🔴 Driver going OFFLINE - Stopping location tracking");
        
        if (ride) {
          Alert.alert(
            "Active Ride",
            "You have an active ride. Please complete it before going offline.",
            [{ text: "OK" }]
          );
          return;
        }

        // Stop background tracking immediately
        stopBackgroundLocationTracking();

        // Notify socket if available (emit before disconnect)
        if (socket && socket.connected) {
          socket.emit("driverWentOffline", { driverId });
        }

        // Set states (this will trigger socket disconnect via useEffect)
        setIsDriverOnline(false);
        setDriverStatus("offline");

        // Save offline status
        await AsyncStorage.setItem("driverOnlineStatus", "offline");

        Alert.alert("🔴 Offline", "You are now offline and won't receive ride requests");
      }
    } catch (error) {
      console.error("❌ Error toggling online status:", error);
      Alert.alert("Error", "Failed to change status. Please try again.");
    }
  };

  // Load driver info and verify token on mount
  useEffect(() => {
    const loadDriverInfo = async () => {
      try {
        console.log("🔍 Loading driver info from AsyncStorage...");
        const storedDriverId = await AsyncStorage.getItem("driverId");
        const storedDriverName = await AsyncStorage.getItem("driverName");
        const token = await AsyncStorage.getItem("authToken");
        const savedOnlineStatus = await AsyncStorage.getItem("driverOnlineStatus");
        
        if (storedDriverId && storedDriverName && token) {
          setDriverId(storedDriverId);
          setDriverName(storedDriverName);
          console.log("✅ Token found, skipping verification");
          
          // Restore online status if it was online before
          if (savedOnlineStatus === "online") {
            setIsDriverOnline(true);
            setDriverStatus("online");
            // Start tracking (socket connect triggered by useEffect on isDriverOnline)
            startBackgroundLocationTracking();
          }
         
          if (!location) {
            try {
              const pos = await new Promise<Geolocation.GeoPosition>((resolve, reject) => {
                Geolocation.getCurrentPosition(resolve, reject, {
                  enableHighAccuracy: true,
                  timeout: 15000,
                  maximumAge: 0
                });
              });
             
              setLocation({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
              setLastCoord({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
            } catch (locationError) {
              console.error("❌ Error getting location:", locationError);
            }
          }
        } else {
          console.log("❌ No driver info or token found, navigating to LoginScreen");
          await AsyncStorage.clear();
          navigation.replace("LoginScreen");
        }
      } catch (error) {
        console.error("❌ Error loading driver info:", error);
        await AsyncStorage.clear();
        navigation.replace("LoginScreen");
      }
    };
    
    if (!driverId || !driverName) {
      loadDriverInfo();
    }
  }, [driverId, driverName, navigation, location]);

  // Request user location when ride is accepted
  useEffect(() => {
    if (rideStatus === "accepted" && ride?.rideId && socket) {
      console.log("📍 Requesting initial user location for accepted ride");
      socket.emit("getUserDataForDriver", { rideId: ride.rideId });
      const intervalId = setInterval(() => {
        if (rideStatus === "accepted" || rideStatus === "started") {
          socket.emit("getUserDataForDriver", { rideId: ride.rideId });
        }
      }, 10000);
      return () => clearInterval(intervalId);
    }
  }, [rideStatus, ride?.rideId]);

  // Optimized location saving
  const saveLocationToDatabase = useCallback(
    async (location: LocationType) => {
      try {
        locationUpdateCount.current++;
        if (locationUpdateCount.current % 3 !== 0) { // Send every 3rd update
          return;
        }
        
        const payload = {
          driverId,
          driverName: driverName || "Unknown Driver",
          latitude: location.latitude,
          longitude: location.longitude,
          vehicleType: "taxi",
          status: driverStatus === "onRide" ? "onRide" : isDriverOnline ? "Live" : "offline",
          rideId: driverStatus === "onRide" ? ride?.rideId : null,
          timestamp: new Date().toISOString(),
        };

        const response = await fetch(`${API_BASE}/driver-location/update`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${await AsyncStorage.getItem("authToken")}`,
          },
          body: JSON.stringify(payload),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error("❌ Failed to save location:", errorText);
          return;
        }

        if (socket && socket.connected && isDriverOnline) {
          // 🆕 Emit as per requirement
          socket.emit('driverLocation', { latitude: location.latitude, longitude: location.longitude });
        }
      } catch (error) {
        console.error("❌ Error saving location to DB:", error);
      }
    },
    [driverId, driverName, driverStatus, ride?.rideId, isDriverOnline]
  );

  // Register driver with socket
  useEffect(() => {
    if (!isRegistered && driverId && location && isDriverOnline && socket) {
      console.log("📝 Registering driver with socket:", driverId);
      socket.emit("registerDriver", {
        driverId,
        driverName,
        latitude: location.latitude,
        longitude: location.longitude,
        vehicleType: "taxi",
      });
      setIsRegistered(true);
    }
  }, [driverId, location, isRegistered, driverName, isDriverOnline]);

  // 🆕 Route fetching with real-time updates
  const fetchRoute = useCallback(
    async (origin: LocationType, destination: LocationType) => {
      try {
        console.log("🗺️ Fetching route between:", {
          origin: { lat: origin.latitude, lng: origin.longitude },
          destination: { lat: destination.latitude, lng: destination.longitude },
        });
        
        const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
          const coords = data.routes[0].geometry.coordinates.map(
            ([lng, lat]: number[]) => ({
              latitude: lat,
              longitude: lng,
            })
          );
          console.log("✅ Route fetched, coordinates count:", coords.length);
          return coords;
        }
      } catch (error) {
        console.error("❌ Error fetching route:", error);
        // Return a straight line route as fallback
        return [origin, destination];
      }
    },
    []
  );

  // Find nearest point on route
  const findNearestPointOnRoute = useCallback(
    (currentLocation: LocationType, routeCoords: LocationType[]) => {
      if (!routeCoords || routeCoords.length === 0) return null;
      
      let minDistance = Infinity;
      let nearestIndex = 0;
      
      for (let i = 0; i < routeCoords.length; i++) {
        const distance = haversine(currentLocation, routeCoords[i]);
        if (distance < minDistance) {
          minDistance = distance;
          nearestIndex = i;
        }
      }
      
      return { index: nearestIndex, distance: minDistance };
    },
    []
  );

  // 🆕 Update visible route as driver moves (Dynamic Polyline)
  const updateVisibleRoute = useCallback(() => {
    if (!location || !fullRouteCoords.length) {
      return;
    }
    
    const nearestPoint = findNearestPointOnRoute(location, fullRouteCoords);
    if (!nearestPoint) return;
    
    // Update the polyline to show only the remaining route
    const remainingRoute = fullRouteCoords.slice(nearestPoint.index);
   
    if (remainingRoute.length > 0) {
      const updatedRoute = [location, ...remainingRoute];
      setVisibleRouteCoords(updatedRoute);
      setNearestPointIndex(nearestPoint.index);
      console.log(`📍 Route updated: ${remainingRoute.length} points remaining`);
    }
  }, [location, fullRouteCoords, findNearestPointOnRoute]);

  // Throttled route update
  const throttledUpdateVisibleRoute = useCallback(() => {
    if (routeUpdateThrottle.current) {
      clearTimeout(routeUpdateThrottle.current);
    }
    
    routeUpdateThrottle.current = setTimeout(() => {
      updateVisibleRoute();
    }, 2000); // Update every 2 seconds
  }, [updateVisibleRoute]);

  // 🆕 Automatically update route as driver moves
  useEffect(() => {
    if ((rideStatus === "accepted" || rideStatus === "started") && fullRouteCoords.length > 0) {
      throttledUpdateVisibleRoute();
    }
  }, [location, rideStatus, fullRouteCoords, throttledUpdateVisibleRoute]);

  // Smooth map animation
  const animateToLocation = useCallback(
    (targetLocation: LocationType, shouldIncludeUser: boolean = false) => {
      if (!mapRef.current || mapAnimationInProgress.current) return;
      
      mapAnimationInProgress.current = true;
      let region = {
        latitude: targetLocation.latitude,
        longitude: targetLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

      if (shouldIncludeUser && userLocation && location) {
        const points = [location, userLocation, targetLocation];
        const lats = points.map((p) => p.latitude);
        const lngs = points.map((p) => p.longitude);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const midLat = (minLat + maxLat) / 2;
        const midLng = (minLng + maxLng) / 2;
        const latDelta = (maxLat - minLat) * 1.2;
        const lngDelta = (maxLng - minLng) * 1.2;
        
        region = {
          latitude: midLat,
          longitude: midLng,
          latitudeDelta: Math.max(latDelta, 0.02),
          longitudeDelta: Math.max(lngDelta, 0.02),
        };
      }

      setMapRegion(region);
      mapRef.current.animateToRegion(region, 1000);
      
      setTimeout(() => {
        mapAnimationInProgress.current = false;
      }, 1000);
    },
    [userLocation, location]
  );

  // Start navigation (called after OTP verification)
  const startNavigation = useCallback(async () => {
    if (!ride?.pickup || !ride?.drop) return;
    console.log("🚀 Starting navigation from pickup to drop location");
   
    try {
      const routeCoords = await fetchRoute(ride.pickup, ride.drop);
      if (routeCoords && routeCoords.length > 0) {
        console.log("✅ Navigation route fetched successfully:", routeCoords.length, "points");
       
        setFullRouteCoords(routeCoords);
        setVisibleRouteCoords(routeCoords);
       
        console.log("🗺️ Navigation started with dynamic route updates");
      }
    } catch (error) {
      console.error("❌ Error starting navigation:", error);
    }
  }, [ride?.pickup, ride?.drop, fetchRoute]);

  // Stop navigation
  const stopNavigation = useCallback(() => {
    console.log("🛑 Stopping navigation mode");
    if (navigationInterval.current) {
      clearInterval(navigationInterval.current);
      navigationInterval.current = null;
    }
  }, []);

  // Logout function
  const handleLogout = async () => {
    try {
      console.log("🚪 Initiating logout for driver:", driverId);
      
      if (ride) {
        Alert.alert(
          "Active Ride",
          "Please complete your current ride before logging out.",
          [{ text: "OK" }]
        );
        return;
      }

      // Stop background tracking
      stopBackgroundLocationTracking();

      await api.post("/drivers/logout");
      await AsyncStorage.clear();
      console.log("✅ AsyncStorage cleared");
      if (socket) {
        socket.disconnect();
      }
      navigation.replace("LoginScreen");
      console.log("🧭 Navigated to LoginScreen");
    } catch (err) {
      console.error("❌ Error during logout:", err);
      Alert.alert("❌ Logout Error", "Failed to logout. Please try again.");
    }
  };

  // Accept ride
  const acceptRide = async (rideId?: string) => {
    const currentRideId = rideId || ride?.rideId;
    if (!currentRideId) {
      Alert.alert("Error", "No ride ID available. Please try again.");
      return;
    }
    
    if (!driverId) {
      Alert.alert("Error", "Driver not properly registered.");
      return;
    }
    
    if (socket && !socket.connected) {
      Alert.alert("Connection Error", "Reconnecting to server...");
      socket.connect();
      socket.once("connect", () => {
        setTimeout(() => acceptRide(currentRideId), 1000);
      });
      return;
    }
    
    setIsLoading(true);
    setRideStatus("accepted");
    setDriverStatus("onRide");
    
    if (socket) {
      socket.emit(
        "acceptRide",
        {
          rideId: currentRideId,
          driverId: driverId,
          driverName: driverName,
        },
        async (response: any) => {
          setIsLoading(false);
          if (!isMounted.current) return;
          
          if (response && response.success) {
            const userDataWithId = {
              name: response.userName || "User",
              mobile: response.userMobile || "N/A",
              location: {
                latitude: response.pickup.lat,
                longitude: response.pickup.lng,
              },
              userId: response.userId,
            };
            
            setUserData(userDataWithId);
            const initialUserLocation = {
              latitude: response.pickup.lat,
              longitude: response.pickup.lng,
            };
            
            setUserLocation(initialUserLocation);
            
            if (location) {
              // 🆕 Generate dynamic route from driver to pickup (GREEN ROUTE)
              try {
                const pickupRoute = await fetchRoute(location, initialUserLocation);
                if (pickupRoute) {
                  setFullRouteCoords(pickupRoute);
                  setVisibleRouteCoords(pickupRoute);
                  console.log("✅ Driver to pickup route generated and will update dynamically");
                }
              } catch (error) {
                console.error("❌ Error generating pickup route:", error);
              }
             
              animateToLocation(initialUserLocation, true);
            }

            socket.emit("driverAcceptedRide", {
              rideId: currentRideId,
              driverId: driverId,
              userId: response.userId,
              driverLocation: location,
            });
            
            setTimeout(() => {
              socket.emit("getUserDataForDriver", { rideId: currentRideId });
            }, 1000);
          }
        }
      );
    }
  };

  // Reject ride
  const rejectRide = (rideId?: string) => {
    const currentRideId = rideId || ride?.rideId;
    if (!currentRideId) return;
    
    // 🆕 Clean map data
    clearMapData();
    
    setRide(null);
    setRideStatus("idle");
    setDriverStatus("online");
    setUserData(null);
    setUserLocation(null);
    
    if (socket) {
      socket.emit("rejectRide", {
        rideId: currentRideId,
        driverId,
      });
    }
    
    Alert.alert("Ride Rejected ❌", "You rejected the ride");
  };

  // 🆕 Clear all map data (markers, routes, polylines)
  const clearMapData = useCallback(() => {
    console.log("🧹 Clearing all map data");
    setFullRouteCoords([]);
    setVisibleRouteCoords([]);
    setNearestPointIndex(0);
    setUserLocation(null);
    setTravelledKm(0);
    setLastCoord(null);
    distanceSinceOtp.current = 0;
    lastLocationBeforeOtp.current = null;
    
    // Reset map region to driver's current location
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    }
  }, [location]);

  const confirmOTP = async () => {
    if (!ride) return;
    
    if (!ride.otp) {
      Alert.alert("Error", "OTP not yet received. Please wait...");
      return;
    }
    
    if (enteredOtp === ride.otp) {
      setTravelledKm(0);
      distanceSinceOtp.current = 0;
      lastLocationBeforeOtp.current = location;
      
      setOtpSharedTime(new Date());
      setRideStatus("started");
      setOtpModalVisible(false);
      setEnteredOtp("");
      
      console.log("✅ OTP Verified - Starting navigation from pickup to drop");
      
      if (ride.pickup && ride.drop) {
        // 🆕 Start navigation with dynamic route from pickup to drop (RED ROUTE)
        await startNavigation();
        animateToLocation(ride.drop, true);
      }

      if (socket) {
        socket.emit("otpVerified", {
          rideId: ride.rideId,
          driverId: driverId,
          userId: userData?.userId,
          timestamp: new Date().toISOString(),
          driverLocation: location
        });

        socket.emit("driverStartedRide", {
          rideId: ride.rideId,
          driverId: driverId,
          userId: userData?.userId,
          driverLocation: location,
          otpVerified: true,
          timestamp: new Date().toISOString()
        });

        socket.emit("rideStatusUpdate", {
          rideId: ride.rideId,
          status: "started",
          otpVerified: true,
          timestamp: new Date().toISOString()
        });
      }
      
      console.log("📢 Emitted OTP verification events to user");
      
      Alert.alert(
        "OTP Verified ✅",
        "Navigation started. Route will update dynamically as you move.",
        [{ text: "OK" }]
      );
    } else {
      Alert.alert("Invalid OTP", "Please check the OTP and try again.");
    }
  };

  const completeRide = async () => {
    if (!ride) return;
    
    stopNavigation();
    
    try {
      const finalDistance = distanceSinceOtp.current;
      let finalFare = ride.fare || 0;
      
      console.log(`💰 Using admin-set fare: ₹${finalFare} for ${finalDistance.toFixed(2)}km`);
      
      setBillDetails({
        distance: `${finalDistance.toFixed(2)} km`,
        travelTime: `${Math.round(finalDistance * 10)} mins`,
        charge: Math.round(finalFare),
        userName: userData?.name || 'Customer',
        userMobile: userData?.mobile || 'N/A'
      });
      
      setShowBillModal(true);
      
      if (socket) {
        socket.emit("driverCompletedRide", {
          rideId: ride.rideId,
          driverId: driverId,
          userId: userData?.userId,
          distance: finalDistance,
          fare: finalFare
        });
        
        socket.emit("completeRide", {
          rideId: ride.rideId,
          driverId,
          distance: finalDistance,
          fare: finalFare
        });
      }
      
    } catch (error) {
      console.error("❌ Error completing ride:", error);
      Alert.alert("Error", "Failed to complete ride. Please try again.");
    }
  };

  // 🆕 Handle bill modal close with map cleanup
  const handleBillModalClose = () => {
    setShowBillModal(false);
    setRideStatus("completed");
    setDriverStatus("online");
    
    // 🆕 Clean all map data after ride completion
    clearMapData();
    
    // Reset all ride states
    setRide(null);
    setUserData(null);
    setOtpSharedTime(null);
    
    console.log("✅ Ride completed and map cleaned");
  };

  // Handle verification modal close
  const handleVerificationModalClose = () => {
    setShowVerificationModal(false);
  };

  // Handle ride requests
  const handleRideRequest = (data: any) => {
    if (!isMounted.current || !data?.rideId || !isDriverOnline) return;
    
    try {
      const rideData: RideType = {
        rideId: data.rideId,
        RAID_ID: data.RAID_ID || "N/A",
        otp: data.otp || "0000",
        pickup: {
          latitude: data.pickup?.lat || data.pickup?.latitude || 0,
          longitude: data.pickup?.lng || data.pickup?.longitude || 0,
          address: data.pickup?.address || "Unknown location",
        },
        drop: {
          latitude: data.drop?.lat || data.drop?.latitude || 0,
          longitude: data.drop?.lng || data.drop?.longitude || 0,
          address: data.drop?.address || "Unknown location",
        },
        fare: data.fare || 0,
        distance: data.distance || "0 km",
        userName: data.userName || "Customer",
        userMobile: data.userMobile || "N/A",
      };
      
      setRide(rideData);
      setRideStatus("onTheWay");
      
      Alert.alert(
        "🚖 New Ride Request!",
        `📍 Pickup: ${rideData.pickup.address}\n🎯 Drop: ${rideData.drop.address}\n💰 Fare: ₹${rideData.fare}\n📏 Distance: ${rideData.distance}\n👤 Customer: ${rideData.userName}`,
        [
          {
            text: "❌ Reject",
            onPress: () => rejectRide(rideData.rideId),
            style: "destructive",
          },
          {
            text: "✅ Accept",
            onPress: () => acceptRide(rideData.rideId),
          },
        ],
        { cancelable: false }
      );
    } catch (error) {
      console.error("❌ Error processing ride request:", error);
      Alert.alert("Error", "Could not process ride request. Please try again.");
    }
  };

  // Socket event listeners
  useEffect(() => {
    if (!socket) {
      console.warn("⚠️ Socket not available, skipping socket event listeners");
      return;
    }

    const handleConnect = () => {
      if (!isMounted.current) return;
      setSocketConnected(true);
      
      if (location && driverId && isDriverOnline) {
        socket.emit("registerDriver", {
          driverId,
          driverName,
          latitude: location.latitude,
          longitude: location.longitude,
          vehicleType: "taxi",
        });
        setIsRegistered(true);
      }
    };

    const handleRideRequest = (data: any) => {
      if (!isMounted.current || !data?.rideId || !isDriverOnline) return;
      
      try {
        const rideData: RideType = {
          rideId: data.rideId,
          RAID_ID: data.RAID_ID || "N/A",
          otp: data.otp || "0000",
          pickup: {
            latitude: data.pickup?.lat || data.pickup?.latitude || 0,
            longitude: data.pickup?.lng || data.pickup?.longitude || 0,
            address: data.pickup?.address || "Unknown location",
          },
          drop: {
            latitude: data.drop?.lat || data.drop?.latitude || 0,
            longitude: data.drop?.lng || data.drop?.longitude || 0,
            address: data.drop?.address || "Unknown location",
          },
          fare: data.fare || 0,
          distance: data.distance || "0 km",
          userName: data.userName || "Customer",
          userMobile: data.userMobile || "N/A",
        };
        
        setRide(rideData);
        setRideStatus("onTheWay");
        
        Alert.alert(
          "🚖 New Ride Request!",
          `📍 Pickup: ${rideData.pickup.address}\n🎯 Drop: ${rideData.drop.address}\n💰 Fare: ₹${rideData.fare}\n📏 Distance: ${rideData.distance}\n👤 Customer: ${rideData.userName}`,
          [
            {
              text: "❌ Reject",
              onPress: () => rejectRide(rideData.rideId),
              style: "destructive",
            },
            {
              text: "✅ Accept",
              onPress: () => acceptRide(rideData.rideId),
            },
          ],
          { cancelable: false }
        );
      } catch (error) {
        console.error("❌ Error processing ride request:", error);
        Alert.alert("Error", "Could not process ride request. Please try again.");
      }
    };

    const handleUserLiveLocationUpdate = (data: any) => {
      if (!isMounted.current) return;
      
      if (data && typeof data.lat === "number" && typeof data.lng === "number") {
        const newUserLocation = {
          latitude: data.lat,
          longitude: data.lng,
        };
        
        setUserLocation((prev) => {
          if (
            !prev ||
            prev.latitude !== newUserLocation.latitude ||
            prev.longitude !== newUserLocation.longitude
          ) {
            return newUserLocation;
          }
          return prev;
        });
        
        setUserData((prev) => {
          if (prev) {
            return { ...prev, location: newUserLocation };
          }
          return prev;
        });
      }
    };

    const handleUserDataForDriver = (data: any) => {
      if (!isMounted.current) return;
      
      if (data && data.userCurrentLocation) {
        const userLiveLocation = {
          latitude: data.userCurrentLocation.latitude,
          longitude: data.userCurrentLocation.longitude,
        };
        
        setUserLocation(userLiveLocation);
        
        if (userData && !userData.userId && data.userId) {
          setUserData((prev) => (prev ? { ...prev, userId: data.userId } : null));
        }
      }
    };

    const handleRideOTP = (data: any) => {
      if (!isMounted.current) return;
      
      if (ride && ride.rideId === data.rideId) {
        setRide((prev) => (prev ? { ...prev, otp: data.otp } : null));
      }
    };

    const handleDisconnect = () => {
      if (!isMounted.current) return;
      setSocketConnected(false);
      setIsRegistered(false);
      
      if (ride) {
        setUserData(null);
        setUserLocation(null);
        Alert.alert("Connection Lost", "Reconnecting to server...");
      }
    };

    const handleConnectError = (error: Error) => {
      if (!isMounted.current) return;
      setSocketConnected(false);
      setError("Failed to connect to server");
    };

    const handleRideCancelled = (data: any) => {
      if (!isMounted.current) return;
      
      if (ride && ride.rideId === data.rideId) {
        stopNavigation();
        
        socket.emit("driverRideCancelled", {
          rideId: ride.rideId,
          driverId: driverId,
          userId: userData?.userId,
        });
        
        // 🆕 Clean map after cancellation
        clearMapData();
        
        setRide(null);
        setUserData(null);
        setRideStatus("idle");
        setDriverStatus("online");
        
        Alert.alert("Ride Cancelled", "The passenger cancelled the ride.");
      }
    };

    const handleRideAlreadyAccepted = (data: any) => {
      if (!isMounted.current) return;
      
      if (ride && ride.rideId === data.rideId) {
        // 🆕 Clean map
        clearMapData();
        
        setRide(null);
        setUserData(null);
        setRideStatus("idle");
        setDriverStatus("online");
        
        Alert.alert(
          "Ride Taken",
          data.message || "This ride has already been accepted by another driver."
        );
      }
    };

    const handleRideStarted = (data: any) => {
      if (!isMounted.current) return;
      
      if (ride && ride.rideId === data.rideId) {
        console.log("🎉 Ride started - showing verification modal");
        
        setVerificationDetails({
          pickup: ride.pickup.address || "Pickup location",
          dropoff: ride.drop.address || "Dropoff location",
          time: new Date().toLocaleTimeString(),
          speed: currentSpeed,
          distance: distanceSinceOtp.current,
        });
        
        setShowVerificationModal(true);
      }
    };

    socket.on("connect", handleConnect);
    socket.on("newRideRequest", handleRideRequest);
    socket.on("userLiveLocationUpdate", handleUserLiveLocationUpdate);
    socket.on("userDataForDriver", handleUserDataForDriver);
    socket.on("rideOTP", handleRideOTP);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("rideCancelled", handleRideCancelled);
    socket.on("rideAlreadyAccepted", handleRideAlreadyAccepted);
    socket.on("rideStarted", handleRideStarted);
    
    // 🆕 Removed unconditional socket.connect() - now handled by online status useEffect
    
    return () => {
      socket.off("connect", handleConnect);
      socket.off("newRideRequest", handleRideRequest);
      socket.off("userLiveLocationUpdate", handleUserLiveLocationUpdate);
      socket.off("userDataForDriver", handleUserDataForDriver);
      socket.off("rideOTP", handleRideOTP);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("rideCancelled", handleRideCancelled);
      socket.off("rideAlreadyAccepted", handleRideAlreadyAccepted);
      socket.off("rideStarted", handleRideStarted);
    };
  }, [location, driverId, driverName, ride, rideStatus, userData, stopNavigation, currentSpeed, isDriverOnline, clearMapData]);

  // UI Rendering
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => setError(null)}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4caf50" />
        <Text style={styles.loadingText}>Fetching your location...</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            Geolocation.getCurrentPosition(
              (pos) => {
                setLocation({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                });
              },
              (err) => {
                Alert.alert(
                  "Location Error",
                  "Could not get your location. Please check GPS settings."
                );
              },
              { enableHighAccuracy: true, timeout: 15000 }
            );
          }}
        >
          <Text style={styles.retryText}>Retry Location</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation
        showsMyLocationButton
        showsCompass={true}
        showsScale={true}
        zoomControlEnabled={true}
        rotateEnabled={true}
        scrollEnabled={true}
        zoomEnabled={true}
        region={mapRegion}
      >
        {ride && (
          <Marker
            coordinate={ride.pickup}
            title="Pickup Location"
            description={ride.pickup.address}
            pinColor="blue"
          />
        )}
        
        {ride && (
          <Marker
            coordinate={ride.drop}
            title="Drop Location"
            description={ride.drop.address}
            pinColor="red"
          />
        )}
       
        {/* 🆕 RED ROUTE - Dynamic polyline after OTP (pickup to drop) */}
        {rideStatus === "started" && visibleRouteCoords.length > 0 && (
          <Polyline
            coordinates={visibleRouteCoords}
            strokeWidth={6}
            strokeColor="#F44336"
            lineCap="round"
            lineJoin="round"
          />
        )}
       
        {/* 🆕 GREEN ROUTE - Dynamic polyline before OTP (driver to pickup) */}
        {rideStatus === "accepted" && visibleRouteCoords.length > 0 && (
          <Polyline
            coordinates={visibleRouteCoords}
            strokeWidth={5}
            strokeColor="#4caf50"
            lineCap="round"
            lineJoin="round"
          />
        )}
       
        {ride && (rideStatus === "accepted" || rideStatus === "started") && userLocation && (
          <Marker
            coordinate={userLocation}
            title="User Live Location"
            description={`${userData?.name || "User"} - Live Location`}
            tracksViewChanges={false}
          >
            <View style={styles.blackDotMarker}>
              <View style={styles.blackDotInner} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* 🆕 Online/Offline Toggle Button */}
      {!ride && (
        <View style={styles.onlineToggleContainer}>
          <TouchableOpacity
            style={[
              styles.onlineToggleButton,
              isDriverOnline ? styles.onlineButton : styles.offlineButton
            ]}
            onPress={toggleOnlineStatus}
          >
            <View style={styles.toggleContent}>
              <View style={[
                styles.toggleIndicator,
                { backgroundColor: isDriverOnline ? "#4caf50" : "#f44336" }
              ]} />
              <Text style={styles.toggleButtonText}>
                {isDriverOnline ? "🟢 ONLINE" : "🔴 OFFLINE"}
              </Text>
            </View>
            {backgroundTrackingActive && (
              <Text style={styles.trackingText}>📍 Live tracking active</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.statusContainer}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusIndicator,
              { backgroundColor: socketConnected ? "#4caf50" : "#f44336" },
            ]}
          />
          <Text style={styles.statusText}>
            {socketConnected ? "Connected" : "Disconnected"}
          </Text>
          <View
            style={[
              styles.statusIndicator,
              {
                backgroundColor:
                  driverStatus === "online"
                    ? "#4caf50"
                    : driverStatus === "onRide"
                    ? "#ff9800"
                    : "#f44336",
              },
            ]}
          />
          <Text style={styles.statusText}>{driverStatus.toUpperCase()}</Text>
        </View>
        
        {ride && (rideStatus === "accepted" || rideStatus === "started") && userLocation && (
          <Text style={styles.userLocationText}>
            🟢 User Live: {userLocation.latitude.toFixed(4)},{" "}
            {userLocation.longitude.toFixed(4)}
          </Text>
        )}
        
        {rideStatus === "started" && (
          <Text style={styles.distanceText}>
            📏 Distance Travelled: {travelledKm.toFixed(2)} km
          </Text>
        )}
      </View>

      {ride && (rideStatus === "accepted" || rideStatus === "started") && userData && (
        <View style={styles.userDataContainer}>
          <Text style={styles.userDataTitle}>Passenger Details</Text>
          <View style={styles.userInfoRow}>
            <Text style={styles.userInfoLabel}>Name:</Text>
            <Text style={styles.userInfoValue}>{userData.name}</Text>
          </View>
          <View style={styles.userInfoRow}>
            <Text style={styles.userInfoLabel}>Mobile:</Text>
            <Text style={styles.userInfoValue}>{userData.mobile}</Text>
          </View>
          <View style={styles.userInfoRow}>
            <Text style={styles.userInfoLabel}>Pickup:</Text>
            <Text style={styles.userInfoValue} numberOfLines={2}>
              {ride.pickup.address}
            </Text>
          </View>
          <View style={styles.userInfoRow}>
            <Text style={styles.userInfoLabel}>Drop:</Text>
            <Text style={styles.userInfoValue} numberOfLines={2}>
              {ride.drop.address}
            </Text>
          </View>
          {userLocation && (
            <View style={styles.liveStatus}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE LOCATION TRACKING ACTIVE</Text>
            </View>
          )}
        </View>
      )}

      {ride && rideStatus === "onTheWay" && (
        <View style={styles.rideActions}>
          <TouchableOpacity
            style={[styles.button, styles.acceptButton]}
            onPress={() => acceptRide()}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Accept Ride</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.rejectButton]}
            onPress={() => rejectRide()}
          >
            <Text style={styles.btnText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}

      {ride && rideStatus === "accepted" && (
        <TouchableOpacity
          style={[styles.button, styles.startButton]}
          onPress={() => setOtpModalVisible(true)}
        >
          <Text style={styles.btnText}>Enter OTP & Start Ride</Text>
        </TouchableOpacity>
      )}

      {ride && rideStatus === "started" && (
        <TouchableOpacity
          style={[styles.button, styles.completeButton]}
          onPress={completeRide}
        >
          <Text style={styles.btnText}>
            Complete Ride ({distanceSinceOtp.current.toFixed(2)} km)
          </Text>
        </TouchableOpacity>
      )}

      {/* Logout Button */}
      {!ride && (
        <TouchableOpacity
          style={[styles.button, styles.logoutButton]}
          onPress={handleLogout}
        >
          <Text style={styles.btnText}>Logout</Text>
        </TouchableOpacity>
      )}

      {/* 🆕 Test Notification Button */}
      {!ride && (
        <TouchableOpacity
          style={[styles.button, styles.testNotificationButton]}
          onPress={testNotification}
        >
          <Text style={styles.btnText}>Test Notification</Text>
        </TouchableOpacity>
      )}

      {/* OTP Modal */}
      <Modal visible={otpModalVisible} transparent animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter OTP</Text>
            <Text style={styles.modalSubtitle}>Please ask passenger for OTP</Text>
            <TextInput
              placeholder="Enter 4-digit OTP"
              value={enteredOtp}
              onChangeText={setEnteredOtp}
              keyboardType="numeric"
              style={styles.input}
              maxLength={4}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={() => setOtpModalVisible(false)}
              >
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.confirmButton]}
                onPress={confirmOTP}
              >
                <Text style={styles.btnText}>Confirm OTP</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Verification Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showVerificationModal}
        onRequestClose={handleVerificationModalClose}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Driver Verified Successfully!</Text>
              <TouchableOpacity onPress={handleVerificationModalClose}>
                <MaterialIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalIconContainer}>
              <FontAwesome name="check-circle" size={60} color="#4CAF50" />
            </View>
            
            <Text style={styles.modalMessage}>
              Good news! You have successfully verified your driver.
            </Text>
            
            <View style={styles.billDetailsContainer}>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Pickup location:</Text>
                <Text style={styles.billValue}>{verificationDetails.pickup}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Drop-off location:</Text>
                <Text style={styles.billValue}>{verificationDetails.dropoff}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Time:</Text>
                <Text style={styles.billValue}>{verificationDetails.time}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Speed:</Text>
                <Text style={styles.billValue}>{verificationDetails.speed.toFixed(2)} km/h</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Distance:</Text>
                <Text style={styles.billValue}>{verificationDetails.distance.toFixed(2)} km</Text>
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.modalConfirmButton}
              onPress={handleVerificationModalClose}
            >
              <Text style={styles.modalConfirmButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Bill Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showBillModal}
        onRequestClose={handleBillModalClose}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ride Completed</Text>
              <TouchableOpacity onPress={handleBillModalClose}>
                <MaterialIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalIconContainer}>
              <FontAwesome name="receipt" size={60} color="#4CAF50" />
            </View>
            
            <Text style={styles.modalMessage}>
              Thank you for completing the ride!
            </Text>
            
            <View style={styles.billDetailsContainer}>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Customer Name:</Text>
                <Text style={styles.billValue}>{billDetails.userName}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Mobile:</Text>
                <Text style={styles.billValue}>{billDetails.userMobile}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Distance:</Text>
                <Text style={styles.billValue}>{billDetails.distance}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Travel Time:</Text>
                <Text style={styles.billValue}>{billDetails.travelTime}</Text>
              </View>
              <View style={styles.billDivider} />
              <View style={styles.billRow}>
                <Text style={styles.billTotalLabel}>Total Amount:</Text>
                <Text style={styles.billTotalValue}>₹{billDetails.charge}</Text>
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.modalConfirmButton}
              onPress={handleBillModalClose}
            >
              <Text style={styles.modalConfirmButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default DriverScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  // 🆕 Online/Offline Toggle Styles
  onlineToggleContainer: {
    position: "absolute",
    top: Platform.OS === "ios" ? 120 : 110,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  onlineToggleButton: {
    padding: 16,
    borderRadius: 12,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  onlineButton: {
    backgroundColor: "#4caf50",
  },
  offlineButton: {
    backgroundColor: "#f44336",
  },
  toggleContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  toggleButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  trackingText: {
    color: "#fff",
    fontSize: 11,
    marginTop: 4,
    textAlign: "center",
    fontWeight: "500",
  },
  statusContainer: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 40,
    left: 16,
    right: 16,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    padding: 12,
    borderRadius: 12,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
    marginRight: 16,
    color: "#333",
  },
  userLocationText: {
    fontSize: 11,
    color: "#4caf50",
    fontWeight: "500",
    marginTop: 2,
  },
  distanceText: {
    fontSize: 11,
    color: "#ff9800",
    fontWeight: "500",
    marginTop: 2,
  },
  rideActions: {
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  button: {
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    flex: 1,
  },
  acceptButton: {
    backgroundColor: "#4caf50",
  },
  rejectButton: {
    backgroundColor: "#f44336",
  },
  startButton: {
    backgroundColor: "#2196f3",
    margin: 16,
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
  },
  completeButton: {
    backgroundColor: "#ff9800",
    margin: 16,
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
  },
  cancelButton: {
    backgroundColor: "#757575",
  },
  confirmButton: {
    backgroundColor: "#4caf50",
  },
  logoutButton: {
    backgroundColor: "#dc3545",
    margin: 16,
    position: "absolute",
    bottom: 80,
    left: 16,
    right: 16,
  },
  testNotificationButton: {
    backgroundColor: "#9c27b0",
    margin: 16,
    position: "absolute",
    bottom: 140,
    left: 16,
    right: 16,
  },
  btnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "white",
    padding: 24,
    borderRadius: 16,
    width: "100%",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    color: "#333",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
  input: {
    borderWidth: 2,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    marginVertical: 16,
    padding: 16,
    fontSize: 18,
    textAlign: "center",
    fontWeight: "600",
    backgroundColor: "#f8f9fa",
  },
  modalButtons: {
    flexDirection: "row",
    marginTop: 8,
    gap: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: "#f44336",
    marginBottom: 20,
    textAlign: "center",
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: "#4caf50",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    elevation: 2,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  blackDotMarker: {
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  blackDotInner: {
    backgroundColor: "#000000",
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  userDataContainer: {
    position: "absolute",
    bottom: 80,
    left: 16,
    right: 16,
    backgroundColor: "#FFFFFF",
    padding: 16,
    borderRadius: 16,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  userDataTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    color: "#333",
  },
  userInfoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  userInfoLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    width: 60,
    marginRight: 8,
  },
  userInfoValue: {
    fontSize: 14,
    color: "#333",
    flex: 1,
    lineHeight: 20,
  },
  liveStatus: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4caf50",
    marginRight: 8,
  },
  liveText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4caf50",
  },
  modalIconContainer: {
    alignItems: "center",
    marginBottom: 15,
  },
  modalMessage: {
    fontSize: 16,
    color: "#333",
    textAlign: "center",
    marginBottom: 20,
  },
  billDetailsContainer: {
    width: "100%",
    backgroundColor: "#F5F5F5",
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  billLabel: {
    fontSize: 14,
    color: "#666666",
    fontWeight: "600",
  },
  billValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333333",
  },
  billDivider: {
    height: 1,
    backgroundColor: "#DDDDDD",
    marginVertical: 10,
  },
  billTotalLabel: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333333",
  },
  billTotalValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#4CAF50",
  },
  modalConfirmButton: {
    backgroundColor: "#4CAF50",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  modalConfirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});




// import React, { useState, useEffect, useRef, useCallback } from "react";
// import {
//   View,
//   Text,
//   TouchableOpacity,
//   StyleSheet,
//   ActivityIndicator,
//   PermissionsAndroid,
//   Platform,
//   Alert,
//   Modal,
//   TextInput,
//   Dimensions,
//   AppState,
// } from "react-native";
// import MapView, { Marker, Polyline } from "react-native-maps";
// import Geolocation from '@react-native-community/geolocation';

// import haversine from "haversine-distance";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { API_BASE } from "./apiConfig";
// import api from "../utils/api";
// import MaterialIcons from "react-native-vector-icons/MaterialIcons";
// import FontAwesome from "react-native-vector-icons/FontAwesome";
// import BackgroundTimer from 'react-native-background-timer';

// import NotificationService from './Notifications'; 

// // Safe import: import functions as module so we can check existence at runtime
// import * as BackgroundLocationService from './BackgroundLocationService';
// import {
//   reconnectSocket,
//   isSocketConnected,
//   enableAutoReconnect,
//   disableAutoReconnect,
//   connectSocket,
//   disconnectSocket
  
// } from './socket';

// const { width, height } = Dimensions.get("window");

// type LocationType = { latitude: number; longitude: number };
// type RideType = {
//   rideId: string;
//   RAID_ID?: string;
//   otp?: string;
//   pickup: LocationType & { address?: string };
//   drop: LocationType & { address?: string };
//   routeCoords?: LocationType[];
//   fare?: number;
//   distance?: string;
//   userName?: string;
//   userMobile?: string;
// };
// type UserDataType = {
//   name: string;
//   mobile: string;
//   location: LocationType;
//   userId?: string;
// };

// // Session tracking types
// type SessionStats = {
//   loginTime: Date | null;
//   totalRidesReceived: number;
//   yourRides: number;
//   ridesMissed: number;
//   earnings: number;
// };

// const DriverScreen = ({ route, navigation }: { route: any; navigation: any }) => {
//   // Existing states
//   const [location, setLocation] = useState<LocationType | null>(
//     route.params?.latitude && route.params?.longitude
//       ? { latitude: route.params.latitude, longitude: route.params.longitude }
//       : null
//   );
//   const [ride, setRide] = useState<RideType | null>(null);
//   const [userData, setUserData] = useState<UserDataType | null>(null);
//   const [userLocation, setUserLocation] = useState<LocationType | null>(null);
//   const [travelledKm, setTravelledKm] = useState(0);
//   const [lastCoord, setLastCoord] = useState<LocationType | null>(null);
//   const [otpModalVisible, setOtpModalVisible] = useState(false);
//   const [enteredOtp, setEnteredOtp] = useState("");
//   const [rideStatus, setRideStatus] = useState<
//     "idle" | "onTheWay" | "accepted" | "started" | "completed"
//   >("idle");
//   const [isRegistered, setIsRegistered] = useState(false);
//   const [socketConnected, setSocketConnected] = useState(false);
//   const [driverStatus, setDriverStatus] = useState<
//     "offline" | "online" | "onRide"
//   >("offline");
//   const [isLoading, setIsLoading] = useState(false);
//   const mapRef = useRef<MapView | null>(null);
// const [driverId, setDriverId] = useState<string>(route.params?.driverId || "");
//   const [driverName, setDriverName] = useState<string>(
//     route.params?.driverName || ""
//   );
//   const [error, setError] = useState<string | null>(null);
//   const [fullRouteCoords, setFullRouteCoords] = useState<LocationType[]>([]);
//   const [visibleRouteCoords, setVisibleRouteCoords] = useState<LocationType[]>([]);
//   const [nearestPointIndex, setNearestPointIndex] = useState<number>(0);
//   const [mapRegion, setMapRegion] = useState<any>(null);


//   const [showVerificationModal, setShowVerificationModal] = useState(false);
//   const [showBillModal, setShowBillModal] = useState(false);
//   const [showSessionSummary, setShowSessionSummary] = useState(false);
//   const [billDetails, setBillDetails] = useState({
//     distance: '0 km',
//     travelTime: '0 mins',
//     charge: 0,
//     userName: '',
//     userMobile: ''
//   });
//   const [verificationDetails, setVerificationDetails] = useState({
//     pickup: '',
//     dropoff: '',
//     time: '',
//     speed: 0,
//     distance: 0,
//   });
//   const [otpSharedTime, setOtpSharedTime] = useState<Date | null>(null);
//   const [currentSpeed, setCurrentSpeed] = useState<number>(0);

//   // Background and session tracking states
//   const [sessionStats, setSessionStats] = useState<SessionStats>({
//     loginTime: null,
//     totalRidesReceived: 0,
//     yourRides: 0,
//     ridesMissed: 0,
//     earnings: 0
//   });
//   const [onlineDuration, setOnlineDuration] = useState(0); // in seconds
//   const [isBackgroundMode, setIsBackgroundMode] = useState(false);
//   const [hasNotificationPermission, setHasNotificationPermission] = useState(false);

//   // Refs for optimization
//   const isMounted = useRef(true);
//   const locationUpdateCount = useRef(0);
//   const mapAnimationInProgress = useRef(false);
//   const navigationInterval = useRef<NodeJS.Timeout | null>(null);
//   const lastLocationUpdate = useRef<LocationType | null>(null);
//   const routeUpdateThrottle = useRef<NodeJS.Timeout | null>(null);
//   const distanceSinceOtp = useRef(0);
//   const lastLocationBeforeOtp = useRef<LocationType | null>(null);
  
//   // Background tracking refs
//   const locationWatchId = useRef<number | null>(null);
//   const backgroundInterval = useRef<NodeJS.Timeout | null>(null);
//   const onlineTimer = useRef<NodeJS.Timeout | null>(null);
//   const appState = useRef(AppState.currentState);
// useEffect(() => {
//   const initializeNotificationSystem = async () => {
//     try {
//       console.log('🔔 Setting up complete notification system...');
      
//       // Initialize the notification service
//       const initialized = await NotificationService.initializeNotifications();
      
//       if (initialized) {
//         console.log('✅ Notification system initialized successfully');
        
//         // Get FCM token and send to server
//         const token = await NotificationService.getFCMToken();
//         if (token && driverId) {
//           await sendFCMTokenToServer(token);
//         }
        
//         // Listen for ride requests
//         NotificationService.on('rideRequest', handleNotificationRideRequest);
        
//         // Listen for token refresh
//         NotificationService.on('tokenRefresh', async (newToken) => {
//           console.log('🔄 FCM token refreshed, updating server...');
//           if (driverId) {
//             await sendFCMTokenToServer(newToken);
//           }
//         });
        
//         setHasNotificationPermission(true);
//       } else {
//         console.log('❌ Notification system initialization failed');
//         setHasNotificationPermission(false);
//       }
//     } catch (error) {
//       console.error('❌ Error in notification system initialization:', error);
//       // Don't block the app if notifications fail
//       setHasNotificationPermission(false);
//     }
//   };

//   // Initialize when driver goes online
//   if ((driverStatus === 'online' || driverStatus === 'onRide') && !hasNotificationPermission) {
//     initializeNotificationSystem();
//   }

//   return () => {
//     // Cleanup
//     NotificationService.off('rideRequest', handleNotificationRideRequest);
//   };
// }, [driverStatus, driverId, hasNotificationPermission]);
//   // In Screen1.tsx - update the sendFCMTokenToServer function




//   // Screen1.tsx-ல் இந்த function add பண்ணு
// const forceRefreshFCM = async () => {
//   try {
//     console.log('🔄 Force refreshing FCM token...');
    
//     const token = await NotificationService.getFCMToken();
//     if (!token) {
//       console.log('❌ No FCM token available');
//       return false;
//     }

//     console.log('📱 New FCM token:', token.substring(0, 20) + '...');
    
//     // Server-க்கு update பண்ணு
//     const authToken = await AsyncStorage.getItem("authToken");
//     const response = await fetch(`${API_BASE}/drivers/update-fcm-token`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${authToken}`,
//       },
//       body: JSON.stringify({
//         driverId: driverId,
//         fcmToken: token,
//         platform: Platform.OS
//       }),
//     });

//     if (response.ok) {
//       console.log('✅ FCM token updated on server');
//       return true;
//     } else {
//       console.log('❌ Failed to update FCM token on server');
//       return false;
//     }
//   } catch (error) {
//     console.error('❌ FCM refresh error:', error);
//     return false;
//   }
// };



//   // Check for pending notifications when app comes to foreground
// useEffect(() => {
//   const checkPendingNotifications = async () => {
//     try {
//       const pendingRide = await AsyncStorage.getItem('pendingRideRequest');
//       if (pendingRide) {
//         console.log('📱 Processing pending ride request from background');
//         const rideData = JSON.parse(pendingRide);
//         handleNotificationRideRequest(rideData);
//         await AsyncStorage.removeItem('pendingRideRequest');
//       }
//     } catch (error) {
//       console.error('Error checking pending notifications:', error);
//     }
//   };

//   const subscription = AppState.addEventListener('change', (nextAppState) => {
//     if (nextAppState === 'active') {
//       checkPendingNotifications();
//     }
//   });

//   return () => subscription.remove();
// }, []);


//   const testNotification = async () => {
//   try {
//     console.log('🧪 Testing notification...');
//     await NotificationService.testNotification();
//     Alert.alert('Test', 'Notification test triggered');
//   } catch (error) {
//     console.error('Test notification failed:', error);
//     Alert.alert('Test Failed', 'Could not show test notification');
//   }
// };


// const sendFCMTokenToServer = async (token: string): Promise<boolean> => {
//   try {
//     const authToken = await AsyncStorage.getItem("authToken");
//     if (!authToken) {
//       console.log('❌ No auth token available');
//       return false;
//     }

//     console.log('📤 Sending FCM token to server...');
    
//     // ✅ CORRECT ENDPOINT - Make sure this matches your backend
//     const response = await fetch(`${API_BASE}/api/drivers/update-fcm-token`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${authToken}`,
//       },
//       body: JSON.stringify({
//         driverId: driverId,
//         fcmToken: token,
//         platform: Platform.OS
//       }),
//     });
    
//     console.log('📡 Response status:', response.status);
    
//     if (response.ok) {
//       const result = await response.json();
//       console.log('✅ FCM token updated on server:', result);
//       return true;
//     } else {
//       const errorText = await response.text();
//       console.log('❌ Server error:', response.status, errorText);
//       return false;
//     }
//   } catch (error) {
//     console.error('❌ Network error sending token:', error);
//     return false;
//   }
// };
// // Add to Screen1.tsx for testing
// const testFullFCMFlow = async () => {
//   try {
//     console.log('🧪 Testing full FCM flow...');
    
//     // 1. Get FCM token
//     const token = await NotificationService.getFCMToken();
//     if (!token) {
//       Alert.alert('Test Failed', 'No FCM token available');
//       return;
//     }
    
//     // 2. Send to server
//     const success = await sendFCMTokenToServer(token);
    
//     // 3. Test local notification
//     await NotificationService.testNotification();
    
//     Alert.alert(
//       'FCM Test Result', 
//       `Token: ${token ? '✅' : '❌'}\nServer: ${success ? '✅' : '❌'}\nLocal: ✅`
//     );
    
//   } catch (error) {
//     console.error('FCM test failed:', error);
//     Alert.alert('Test Failed', error.message);
//   }
// };



// const testFCMEndpoint = async () => {
//   try {
//     const token = await NotificationService.getFCMToken();
//     if (!token) {
//       Alert.alert('Test', 'No FCM token available');
//       return;
//     }

//     const authToken = await AsyncStorage.getItem("authToken");
//     const response = await fetch(`${API_BASE}/api/drivers/update-fcm-token`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${authToken}`,
//       },
//       body: JSON.stringify({
//         driverId: driverId,
//         fcmToken: token,
//         platform: Platform.OS,
//         test: true
//       }),
//     });

//     const result = await response.json();
//     Alert.alert('FCM Test', `Status: ${response.status}\nMessage: ${result.message}`);
    
//   } catch (error) {
//     Alert.alert('FCM Test Failed', error.message);
//   }
// };



// // Add this to check connection status
// useEffect(() => {
//   const checkConnection = async () => {
//     try {
//       const token = await AsyncStorage.getItem('authToken');
//       if (!token) {
//         console.log('❌ No auth token found');
//         navigation.replace('LoginScreen');
//         return;
//       }

//       // Check if driver is registered
//       const driverId = await AsyncStorage.getItem('driverId');
//       if (driverId && location && driverStatus === 'online') {
//         console.log('🔄 Re-registering driver with socket...');
//         const socketInstance = connectSocket();
//         socketInstance.emit("registerDriver", {
//           driverId,
//           driverName,
//           latitude: location.latitude,
//           longitude: location.longitude,
//           vehicleType: "taxi",
//           status: "online"
//         });
//         setIsRegistered(true);
//       }
//     } catch (error) {
//       console.error('❌ Connection check error:', error);
//     }
//   };

//   // Check every 30 seconds
//   const interval = setInterval(checkConnection, 30000);
//   return () => clearInterval(interval);
// }, [location, driverStatus]);

// // Add this function to test notifications
// const testLocalNotification = async () => {
//   try {
//     console.log('🧪 Testing local notification...');
    
//     await NotificationService.showLocalNotification({
//       title: '🚖 Test Ride Request',
//       body: 'This is a test notification from the app',
//       data: {
//         type: 'ride_request',
//         rideId: 'TEST_123',
//         pickup: '{"address":"Test Location","lat":11.341,"lng":77.7172}',
//         drop: '{"address":"Test Destination","lat":11.351,"lng":77.7272}',
//         fare: '100',
//         test: 'true'
//       }
//     });
    
//     Alert.alert('Test', 'Local notification test triggered');
//   } catch (error) {
//     console.error('Test notification failed:', error);
//     Alert.alert('Test Failed', 'Could not show test notification: ' + error.message);
//   }
// };

// // Add this function to test FCM token
// const testFCMToken = async () => {
//   try {
//     const token = await NotificationService.getFCMToken();
//     if (token) {
//       Alert.alert('FCM Token', `Token: ${token.substring(0, 20)}...`);
//       console.log('FCM Token:', token);
//     } else {
//       Alert.alert('FCM Token', 'No token available');
//     }
//   } catch (error) {
//     console.error('FCM token test failed:', error);
//     Alert.alert('FCM Test Failed', error.message);
//   }
// };


// // Test if local notifications work without server
// const testLocalNotificationImmediate = async () => {
//   try {
//     console.log('🧪 Testing immediate local notification...');
    
//     // Test with the exact same data structure as server
//     const testData = {
//       type: 'ride_request',
//       rideId: 'TEST_123456',
//       pickup: '{"address":"Test Location, Erode","lat":11.341,"lng":77.7172}',
//       drop: '{"address":"Test Destination, Erode","lat":11.351,"lng":77.7272}',
//       fare: '100',
//       distance: '5 km',
//       vehicleType: 'taxi',
//       userName: 'Test Customer',
//       userMobile: '9876543210',
//       timestamp: new Date().toISOString(),
//       priority: 'high',
//       test: 'true'
//     };

//     // Show local notification directly
//     await NotificationService.showLocalNotification({
//       title: '🚖 Test Ride Request',
//       body: 'From: Test Location, Erode\nTo: Test Destination, Erode\nFare: ₹100',
//       data: testData
//     });

//     // Also emit the event to test the alert
//     NotificationService.emit('rideRequest', testData);
    
//     Alert.alert('Test', 'Local notification triggered');
//   } catch (error) {
//     console.error('Local notification test failed:', error);
//     Alert.alert('Test Failed', error.message);
//   }
// };


// const updateFCMToken = async (token: string) => {
//   try {
//     const driverId = await AsyncStorage.getItem('driverId');
//     if (!driverId) {
//       console.log('No driverId found, skipping FCM token update');
//       return;
//     }

//     const authToken = await AsyncStorage.getItem('authToken');
//     if (!authToken) {
//       console.log('No auth token found, skipping FCM token update');
//       return;
//     }

//     const response = await fetch(`http://localhost:5001/api/drivers/${driverId}/fcm-token`, {
//       method: 'PUT',
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `Bearer ${authToken}`,
//       },
//       body: JSON.stringify({ fcmToken: token }),
//     });

//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new Error(errorData.msg || 'Failed to update FCM token');
//     }

//     const data = await response.json();
//     console.log('✅ FCM token updated successfully:', data);
//   } catch (error) {
//     console.log('⚠️ FCM token update failed:', error);
//     // Don't continue if auth fails - this might indicate the user needs to re-login
//   }
// };


// const handleNotificationRideRequest = (data: any) => {
//   console.log('📱 Received ride request via notification:', data);
  
//   // ✅ FIXED: Better payload validation
//   if (!data || data.type !== 'ride_request') {
//     console.error('Invalid ride request payload:', data);
//     return;
//   }
  
//   // ✅ FIXED: Handle both field naming conventions
//   const rideData: RideType = {
//     rideId: data.rideId,
//     RAID_ID: data.RAID_ID || "N/A",
//     otp: data.otp || "0000",
//     pickup: {
//       latitude: data.pickup?.lat || data.pickup?.latitude || 0,
//       longitude: data.pickup?.lng || data.pickup?.longitude || 0,
//       address: data.pickup?.address || "Unknown location",
//     },
//     drop: {
//       latitude: data.drop?.lat || data.drop?.latitude || 0,
//       longitude: data.drop?.lng || data.drop?.longitude || 0,
//       address: data.drop?.address || "Unknown location",
//     },
//     fare: data.fare || 0,
//     distance: data.distance || "0 km",
//     // ✅ FIXED: Handle both userName and customerName
//     userName: data.userName || data.customerName || "Customer",
//     userMobile: data.userMobile || "N/A",
//   };
  
//   console.log('📱 Processed ride data:', rideData);
//   handleRideRequest(rideData);
// };




// // Add this useEffect to refresh token periodically
// useEffect(() => {
//   const refreshFCMToken = async () => {
//     try {
//       console.log('🔄 Refreshing FCM token...');
      
//       // Get fresh token
//       const token = await NotificationService.getFCMToken();
//       if (!token) {
//         console.log('❌ No FCM token available');
//         return;
//       }
      
//       console.log('📱 Got fresh FCM token:', token.substring(0, 20) + '...');
      
//       // Send to server
//       const updated = await sendFCMTokenToServer(token);
//       if (updated) {
//         console.log('✅ FCM token refreshed and saved');
//       } else {
//         console.log('❌ Failed to save refreshed FCM token');
//       }
//     } catch (error) {
//       console.error('❌ Error refreshing FCM token:', error);
//     }
//   };
  
//   // Refresh token immediately when component mounts
//   if (driverStatus === 'online' || driverStatus === 'onRide') {
//     refreshFCMToken();
//   }
  
//   // Refresh token every 30 minutes
//   const interval = setInterval(refreshFCMToken, 30 * 60 * 1000);
  
//   return () => clearInterval(interval);
// }, [driverStatus]);

  
//   // Initialize session from storage
//   useEffect(() => {
//     const loadSessionData = async () => {
//       try {
//         const savedSession = await AsyncStorage.getItem('driverSession');
//         if (savedSession) {
//           const sessionData = JSON.parse(savedSession);
//           // Convert loginTime string back to Date object
//           if (sessionData.loginTime) {
//             sessionData.loginTime = new Date(sessionData.loginTime);
//           }
//           setSessionStats(sessionData);
//         }
//       } catch (error) {
//         console.error('Error loading session data:', error);
//       }
//     };
    
//     loadSessionData();
//   }, []);

//   // Save session data to storage
//   const saveSessionData = async (data: SessionStats) => {
//     try {
//       // Convert Date to string for storage
//       const dataToSave = {
//         ...data,
//         loginTime: data.loginTime ? data.loginTime.toISOString() : null
//       };
//       await AsyncStorage.setItem('driverSession', JSON.stringify(dataToSave));
//     } catch (error) {
//       console.error('Error saving session data:', error);
//     }
//   };

//   // App state handler for background/foreground
//   useEffect(() => {
//     const handleAppStateChange = (nextAppState: string) => {
//       if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
//         // App came to foreground - check for pending notifications
//         console.log('🔄 App came to foreground, checking pending notifications');
//         NotificationService.checkPendingNotifications();
//         setIsBackgroundMode(false);
//       } else if (nextAppState.match(/inactive|background/)) {
//         // App went to background
//         setIsBackgroundMode(true);
//         console.log('🔄 App in background - FCM will handle notifications');
//       }
      
//       appState.current = nextAppState;
//     };

//     const subscription = AppState.addEventListener('change', handleAppStateChange);

//     return () => {
//       subscription.remove();
//     };
//   }, []);

//   // Online duration timer
//   useEffect(() => {
//     if (driverStatus === 'online' || driverStatus === 'onRide') {
//       onlineTimer.current = setInterval(() => {
//         setOnlineDuration(prev => prev + 1);
//       }, 1000);
//     } else {
//       if (onlineTimer.current) {
//         clearInterval(onlineTimer.current);
//         onlineTimer.current = null;
//       }
//     }

//     return () => {
//       if (onlineTimer.current) {
//         clearInterval(onlineTimer.current);
//       }
//     };
//   }, [driverStatus]);

//   // Format duration for display
//   const formatDuration = (seconds: number) => {
//     const hrs = Math.floor(seconds / 3600);
//     const mins = Math.floor((seconds % 3600) / 60);
//     const secs = seconds % 60;
//     return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
//   };

//   // Format time for display
//   const formatTime = (date: Date | null) => {
//     if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
//       return 'N/A';
//     }
//     try {
//       return date.toLocaleTimeString('en-IN', { 
//         hour: '2-digit', 
//         minute: '2-digit',
//         hour12: true 
//       });
//     } catch (error) {
//       console.error('Error formatting time:', error);
//       return 'N/A';
//     }
//   };


//   useEffect(() => {
//   const setupCompleteNotifications = async () => {
//     try {
//       console.log('🔔 Setting up complete notification system...');
      
//       // Initialize notifications
//       await NotificationService.setupFCM();
      
//       // Listen for ride requests
//       NotificationService.on('rideRequest', handleNotificationRideRequest);
      
//       // Listen for token refresh
//       NotificationService.on('tokenRefresh', async (newToken) => {
//         console.log('🔄 FCM token refreshed, updating server...');
//         if (driverId) {
//           await sendFCMTokenToServer(newToken);
//         }
//       });
      
//       console.log('✅ Complete notification system setup');
//     } catch (error) {
//       console.error('❌ Error setting up notification system:', error);
//     }
//   };

//   // Setup when driver goes online
//   if (driverStatus === 'online' || driverStatus === 'onRide') {
//     setupCompleteNotifications();
//   }

//   return () => {
//     // Cleanup
//     NotificationService.off('rideRequest', handleNotificationRideRequest);
//     NotificationService.off('tokenRefresh', () => {});
//   };
// }, [driverStatus, driverId]);


//  const forceFCMTokenRefresh = async () => {
//   try {
//     console.log('🔄 Force refreshing FCM token...');
    
//     // Get fresh FCM token
//     const token = await NotificationService.getFCMToken();
//     if (!token) {
//       console.log('❌ No FCM token available');
//       return false;
//     }
    
//     console.log('📱 New FCM token:', token.substring(0, 20) + '...');
    
//     // Send to server immediately
//     const success = await sendFCMTokenToServer(token);
//     if (success) {
//       console.log('✅ FCM token updated successfully');
//       return true;
//     } else {
//       console.log('❌ Failed to update FCM token');
//       return false;
//     }
//   } catch (error) {
//     console.error('❌ Error refreshing FCM token:', error);
//     return false;
//   }
// };

// const goOnline = async () => {
//   try {
//     console.log('🟢 Going online with enhanced FCM...');
    
//     // Check if app is in foreground before requesting permissions
//     if (AppState.currentState !== 'active') {
//       Alert.alert("App Not Active", "Please bring the app to foreground to go online.");
//       return;
//     }

//     // Request location permissions with better error handling
//     if (Platform.OS === "android") {
//       try {
//         const granted = await PermissionsAndroid.request(
//           PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
//           {
//             title: "Location Permission",
//             message: "This app needs access to your location to track rides",
//             buttonNeutral: "Ask Me Later",
//             buttonNegative: "Cancel",
//             buttonPositive: "OK",
//           }
//         );
        
//         if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
//           Alert.alert("Permission Denied", "Location permission is required to go online");
//           return;
//         }
//       } catch (permissionError) {
//         console.error('❌ Permission request error:', permissionError);
//         Alert.alert("Permission Error", "Failed to request location permission");
//         return;
//       }
//     }

//     // Get current location with timeout
//     if (!location) {
//       try {
//         const position = await new Promise<Geolocation.GeoPosition>((resolve, reject) => {
//           Geolocation.getCurrentPosition(
//             resolve,
//             reject,
//             {
//               enableHighAccuracy: true,
//               timeout: 15000,
//               maximumAge: 10000
//             }
//           );
//         });
        
//         const initialLocation = {
//           latitude: position.coords.latitude,
//           longitude: position.coords.longitude,
//         };
//         setLocation(initialLocation);
//       } catch (locationError) {
//         console.error('❌ Error getting location:', locationError);
//         Alert.alert("Location Error", "Could not get your current location. Please check GPS settings.");
//         return;
//       }
//     }

//     // ✅ CRITICAL: Force FCM initialization FIRST
//     console.log('🔔 Force initializing FCM...');
//     try {
//       const initialized = await NotificationService.initializeNotifications();
      
//       if (initialized) {
//         // Get and send FCM token immediately
//         const token = await NotificationService.getFCMToken();
//         if (token) {
//           console.log('📱 FCM token obtained, sending to server...');
//           await sendFCMTokenToServer(token);
//         }
        
//         // Setup listeners
//         NotificationService.on('rideRequest', handleNotificationRideRequest);
        
//         setHasNotificationPermission(true);
//         console.log('✅ FCM setup completed');
//       }
//     } catch (notifError) {
//       console.warn('⚠️ FCM setup warning:', notifError);
//       // Continue even if FCM fails
//     }

//     // Start location tracking
//     await startLocationTracking();
    
//     // Connect socket and register driver
//     console.log('🔌 Connecting socket...');
//     enableAutoReconnect();
//     if (!isSocketConnected()) {
//       connectSocket();
//     }

//     const registerDriver = async () => {
//       if (location && driverId && isSocketConnected()) {
//         console.log('📝 Registering driver with socket...');
//         const socketInstance = connectSocket();
        
//         // ✅ Get FCM token first, then emit
//         let fcmToken = null;
//         try {
//           fcmToken = await NotificationService.getFCMToken();
//         } catch (tokenError) {
//           console.warn('⚠️ Could not get FCM token:', tokenError);
//         }
        
//         socketInstance.emit("registerDriver", {
//           driverId,
//           driverName,
//           latitude: location.latitude,
//           longitude: location.longitude,
//           vehicleType: "taxi",
//           status: "online",
//           fcmToken: fcmToken
//         });
        
//         setIsRegistered(true);
//         setDriverStatus("online");
//         setOnlineDuration(0);
        
//         // Update session stats
//         setSessionStats(prev => ({
//           ...prev,
//           loginTime: prev.loginTime || new Date()
//         }));
        
//         console.log('✅ Driver is now ONLINE with FCM');
//         Alert.alert(
//           "You're Online! 🟢", 
//           "You will now receive ride requests with sound notifications.",
//           [{ text: "OK" }]
//         );
//       } else {
//         console.log('⚠️ Waiting for socket connection...');
//         setTimeout(registerDriver, 1000);
//       }
//     };

//     // Call registerDriver with error handling
//     await registerDriver();
    
//   } catch (error) {
//     console.error('❌ Error going online:', error);
    
//     // More specific error messages
//     if (error instanceof Error) {
//       if (error.message.includes('permissions') || error.message.includes('Activity')) {
//         Alert.alert(
//           "Permission Error", 
//           "Please ensure the app is in foreground and try again."
//         );
//       } else {
//         Alert.alert("Error", "Failed to go online. Please try again.");
//       }
//     } else {
//       Alert.alert("Error", "Failed to go online. Please try again.");
//     }
//   }
// };
// const requestAndroidPermissions = async (): Promise<boolean> => {
//   if (Platform.OS !== 'android') return true;

//   try {
//     const permissions = [
//       PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
//     ];

//     // Only add background location for Android 10+
//     if (Platform.Version >= 29) {
//       permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
//     }

//     const results = await PermissionsAndroid.requestMultiple(permissions);
    
//     const fineLocationGranted = results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === 'granted';
//     const backgroundLocationGranted = results[PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION] === 'granted';
    
//     if (!fineLocationGranted) {
//       Alert.alert(
//         "Permission Required",
//         "Location permission is required to go online. Please enable it in app settings.",
//         [
//           { text: "Cancel", style: "cancel" },
//           { text: "Settings", onPress: () => Linking.openSettings() }
//         ]
//       );
//       return false;
//     }

//     return true;
//   } catch (error) {
//     console.error('Permission request error:', error);
//     return false;
//   }
// };

//   const goOffline = () => {
//     Alert.alert(
//       "Go Offline?",
//       "Are you sure you want to go offline? This will stop all background services.",
//       [
//         {
//           text: "Cancel",
//           style: "cancel"
//         },
//         {
//           text: "Go Offline",
//           style: "destructive",
//           onPress: async () => {
//             await stopLocationTracking();
            
//             // Safely stop background service if function exists
//             if (BackgroundLocationService && typeof BackgroundLocationService.stopBackgroundService === 'function') {
//               try {
//                 await BackgroundLocationService.stopBackgroundService();
//                 console.log('✅ Background service stopped');
//               } catch (e) {
//                 console.warn('Failed to stop background service', e);
//               }
//             }

//             // Disable auto-reconnect and disconnect socket when going offline
//             disableAutoReconnect();
//             try {
//               disconnectSocket();
//               setIsRegistered(false);
//             } catch (err) {
//               console.warn('Error disconnecting socket on offline:', err);
//             }

//             setDriverStatus("offline");
            
//             // Calculate and show session summary
//             const summaryStats = {
//               ...sessionStats,
//               earnings: sessionStats.earnings
//             };
            
//             setSessionStats(summaryStats);
//             setShowSessionSummary(true);
            
//             console.log('❌ Driver is now OFFLINE - all services stopped');
//           }
//         }
//       ]
//     );
//   };



//   // Add these useEffect hooks to your Screen1.tsx

// // Initialize FCM when driver goes online
// useEffect(() => {
//   const initializeFCMForDriver = async () => {
//     try {
//       console.log('🔔 Initializing FCM for driver...');
      
//       // Setup FCM
//       await NotificationService.setupFCM();
      
//       // Check and get FCM token
//       const token = await NotificationService.checkFCMToken();
      
//       if (token && driverId) {
//         // Send token to server
//         await sendFCMTokenToServer(token);
//       }
      
//       // Listen for ride requests via FCM
//       NotificationService.on('rideRequest', handleNotificationRideRequest);
      
//       console.log('✅ FCM initialized for driver');
//     } catch (error) {
//       console.error('❌ Error initializing FCM:', error);
//     }
//   };

//   if (driverStatus === 'online' || driverStatus === 'onRide') {
//     initializeFCMForDriver();
//   }

//   return () => {
//     // Cleanup
//     NotificationService.off('rideRequest', handleNotificationRideRequest);
//   };
// }, [driverStatus, driverId]);


//   // Register driver with socket - ONLY when online
//   useEffect(() => {
//     if (driverStatus === "online" && driverId && location && !isRegistered) {
//       console.log("📝 Registering driver with socket as ONLINE:", driverId);
//       const socketInstance = connectSocket();
//       socketInstance.emit("registerDriver", {
//         driverId,
//         driverName,
//         latitude: location.latitude,
//         longitude: location.longitude,
//         vehicleType: "taxi",
//         status: "online" // Explicit status
//       });
//       setIsRegistered(true);
//     }
//   }, [driverId, location, driverStatus, isRegistered, driverName]);

//   const startLocationTracking = async () => {
//     try {
//       console.log('📍 Starting background location tracking...');
      
//       // Clear any existing watcher
//       if (locationWatchId.current !== null) {
//         Geolocation.clearWatch(locationWatchId.current);
//       }

//       // Get initial position
//       const initialPosition = await new Promise<Geolocation.GeoPosition>((resolve, reject) => {
//         Geolocation.getCurrentPosition(
//           resolve,
//           reject,
//           { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
//         );
//       });

//       const initialLocation = {
//         latitude: initialPosition.coords.latitude,
//         longitude: initialPosition.coords.longitude,
//       };

//       setLocation(initialLocation);
//       lastLocationUpdate.current = initialLocation;

//       // Start watching position - BUT only save to database when online
//       locationWatchId.current = Geolocation.watchPosition(
//         (position) => {
//           if (!isMounted.current) return;

//           const newLocation = {
//             latitude: position.coords.latitude,
//             longitude: position.coords.longitude,
//           };

//           setLocation(newLocation);
//           setCurrentSpeed(position.coords.speed || 0);
//           lastLocationUpdate.current = newLocation;

//           // Calculate distance if we have previous coordinate
//           if (lastCoord) {
//             const dist = haversine(lastCoord, newLocation);
//             const distanceKm = dist / 1000;
            
//             setTravelledKm(prev => prev + distanceKm);
            
//             if (rideStatus === "started" && lastLocationBeforeOtp.current) {
//               distanceSinceOtp.current += distanceKm;
//             }
//           }

//           setLastCoord(newLocation);

//           // CRITICAL FIX: Only save to database when driver is online/onRide
//           if (driverStatus === "online" || driverStatus === "onRide") {
//             saveLocationToDatabase(newLocation).catch(console.error);
//           }

//           // Update map if in foreground and no active ride
//           if (!isBackgroundMode && !ride && mapRef.current && locationUpdateCount.current % 10 === 0) {
//             mapRef.current.animateToRegion(
//               {
//                 latitude: newLocation.latitude,
//                 longitude: newLocation.longitude,
//                 latitudeDelta: 0.01,
//                 longitudeDelta: 0.01,
//               },
//               500
//             );
//           }

//           locationUpdateCount.current++;
//         },
//         (error) => {
//           console.error('📍 Location tracking error:', error);
//         },
//         {
//           enableHighAccuracy: true,
//           distanceFilter: 10, // Update every 10 meters
//           interval: 5000, // Android
//           fastestInterval: 3000, // Android
//           timeout: 15000,
//           useSignificantChanges: false,
//         }
//       );

//       // Start background interval for additional updates - ONLY when online
//       if (backgroundInterval.current) {
//         BackgroundTimer.clearInterval(backgroundInterval.current);
//       }

//       backgroundInterval.current = BackgroundTimer.setInterval(() => {
//         if (isMounted.current && lastLocationUpdate.current && 
//             (driverStatus === "online" || driverStatus === "onRide")) {
//           saveLocationToDatabase(lastLocationUpdate.current).catch(console.error);
//         }
//       }, 30000); // Save every 30 seconds only when online

//     } catch (error) {
//       console.error('❌ Error starting location tracking:', error);
//       Alert.alert("Location Error", "Failed to start location tracking");
//     }
//   };

//   // Stop background location tracking
//   const stopLocationTracking = async () => {
//     console.log('🛑 Stopping background location tracking...');
    
//     // Clear location watcher
//     if (locationWatchId.current !== null) {
//       Geolocation.clearWatch(locationWatchId.current);
//       locationWatchId.current = null;
//     }
    
//     // Clear background timer
//     if (backgroundInterval.current) {
//       BackgroundTimer.clearInterval(backgroundInterval.current);
//       backgroundInterval.current = null;
//     }
    
//     // Clear online timer
//     if (onlineTimer.current) {
//       clearInterval(onlineTimer.current);
//       onlineTimer.current = null;
//     }
    
//     // Notify server that driver is offline
//     if (isSocketConnected() && driverId) {
//       const socketInstance = connectSocket();
//       socketInstance.emit("driverWentOffline", { driverId });
//     }
//   };

//   const saveLocationToDatabase = useCallback(
//     async (location: LocationType) => {
//       try {
//         // Don't save if driver is offline
//         if (driverStatus === "offline") {
//           return;
//         }

//         // Throttle updates in background
//         if (isBackgroundMode && locationUpdateCount.current % 3 !== 0) {
//           return;
//         }

//         const payload = {
//           driverId,
//           driverName: driverName || "Unknown Driver",
//           latitude: location.latitude,
//           longitude: location.longitude,
//           vehicleType: "taxi",
//           status: driverStatus === "onRide" ? "onRide" : "Live",
//           rideId: driverStatus === "onRide" ? ride?.rideId : null,
//           timestamp: new Date().toISOString(),
//           isBackground: isBackgroundMode,
//         };

//         const response = await fetch(`${API_BASE}/driver-location/update`, {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//             Authorization: `Bearer ${await AsyncStorage.getItem("authToken")}`,
//           },
//           body: JSON.stringify(payload),
//         });
        
//         if (!response.ok) {
//           const errorText = await response.text();
//           console.error("❌ Failed to save location:", errorText);
//           return;
//         }

//         // CRITICAL: Only emit socket events when online/onRide
//         if (isSocketConnected() && (driverStatus === "online" || driverStatus === "onRide")) {
//           const socketInstance = connectSocket();
//           socketInstance.emit("driverLocationUpdate", {
//             driverId,
//             latitude: location.latitude,
//             longitude: location.longitude,
//             status: driverStatus === "onRide" ? "onRide" : "Live",
//             rideId: driverStatus === "onRide" ? ride?.rideId : null,
//             isBackground: isBackgroundMode,
//           });
//         }
//       } catch (error) {
//         console.error("❌ Error saving location to DB:", error);
//       }
//     },
//     [driverId, driverName, driverStatus, ride?.rideId, isBackgroundMode]
//   );

//   // Load driver info and verify token on mount
//   useEffect(() => {
//     const loadDriverInfo = async () => {
//       try {
//         console.log("🔍 Loading driver info from AsyncStorage...");
//         const storedDriverId = await AsyncStorage.getItem("driverId");
//         const storedDriverName = await AsyncStorage.getItem("driverName");
//         const token = await AsyncStorage.getItem("authToken");
        
//         if (storedDriverId && storedDriverName && token) {
//           setDriverId(storedDriverId);
//           setDriverName(storedDriverName);
//           console.log("✅ Token found, skipping verification (endpoint returns 404)");
         
//           // If location is not available, try to get it
//           if (!location) {
//             try {
//               const pos = await new Promise<Geolocation.GeoPosition>((resolve, reject) => {
//                 Geolocation.getCurrentPosition(resolve, reject, {
//                   enableHighAccuracy: true,
//                   timeout: 15000,
//                   maximumAge: 0
//                 });
//               });
             
//               setLocation({
//                 latitude: pos.coords.latitude,
//                 longitude: pos.coords.longitude,
//               });
//             } catch (locationError) {
//               console.error("❌ Error getting location:", locationError);
//             }
//           }
//         } else {
//           console.log("❌ No driver info or token found, navigating to LoginScreen");
//           await AsyncStorage.clear();
//           navigation.replace("LoginScreen");
//         }
//       } catch (error: any) {
//         console.error("❌ Error loading driver info:", error);
       
//         // Don't clear storage for 404 errors
//         if (error.response && error.response.status === 404) {
//           console.log("⚠️ 404 error - skipping verification, proceeding with stored credentials");
//           const storedDriverId = await AsyncStorage.getItem("driverId");
//           const storedDriverName = await AsyncStorage.getItem("driverName");
         
//           if (storedDriverId && storedDriverName) {
//             setDriverId(storedDriverId);
//             setDriverName(storedDriverName);
//           } else {
//             await AsyncStorage.clear();
//             navigation.replace("LoginScreen");
//           }
//         } else {
//           await AsyncStorage.clear();
//           navigation.replace("LoginScreen");
//         }
//       }
//     };
    
//     if (!driverId || !driverName) {
//       loadDriverInfo();
//     }
//   }, [driverId, driverName, navigation, location]);

//   // Request user location when ride is accepted
//   useEffect(() => {
//     if (rideStatus === "accepted" && ride?.rideId) {
//       console.log("📍 Requesting initial user location for accepted ride");
//       const socketInstance = connectSocket();
//       socketInstance.emit("getUserDataForDriver", { rideId: ride.rideId });
//       const intervalId = setInterval(() => {
//         if (rideStatus === "accepted" || rideStatus === "started") {
//           const socketInstance = connectSocket();
//           socketInstance.emit("getUserDataForDriver", { rideId: ride.rideId });
//         }
//       }, 10000);
//       return () => clearInterval(intervalId);
//     }
//   }, [rideStatus, ride?.rideId]);

//   useEffect(() => {
//     // Only register when driver explicitly set online
//     if (driverStatus !== 'online') return;

//     if (!isRegistered && driverId && location) {
//       console.log("📝 Registering driver with socket (ONLINE):", driverId);

//       const registerNow = () => {
//         try {
//           const socketInstance = connectSocket();
//           socketInstance.emit("registerDriver", {
//             driverId,
//             driverName,
//             latitude: location.latitude,
//             longitude: location.longitude,
//             vehicleType: "taxi",
//           });
//           setIsRegistered(true);
//           console.log("✅ registerDriver emitted");
//         } catch (err) {
//           console.error("❌ Error emitting registerDriver:", err);
//         }
//       };

//       if (!isSocketConnected()) {
//         // ensure socket connects and then register
//         const socketInstance = connectSocket();
//         socketInstance.once("connect", () => {
//           registerNow();
//         });
//         // Use the explicit helper to connect
//         connectSocket();
//       } else {
//         registerNow();
//       }
//     }
//   }, [driverId, location, isRegistered, driverName, driverStatus]);

//   // Route fetching
//   const fetchRoute = useCallback(
//     async (origin: LocationType, destination: LocationType) => {
//       try {
//         console.log("🗺️ Fetching route between:", {
//           origin: { lat: origin.latitude, lng: origin.longitude },
//           destination: { lat: destination.latitude, lng: destination.longitude },
//         });
        
//         const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson`;
//         const response = await fetch(url);
//         const data = await response.json();
        
//         if (data.routes && data.routes.length > 0) {
//           const coords = data.routes[0].geometry.coordinates.map(
//             ([lng, lat]: number[]) => ({
//               latitude: lat,
//               longitude: lng,
//             })
//           );
//           console.log("✅ Route fetched, coordinates count:", coords.length);
//           return coords;
//         }
//       } catch (error) {
//         console.error("❌ Error fetching route:", error);
//         return null;
//       }
//     },
//     []
//   );

//   // Find nearest point on route
//   const findNearestPointOnRoute = useCallback(
//     (currentLocation: LocationType, routeCoords: LocationType[]) => {
//       if (!routeCoords || routeCoords.length === 0) return null;
      
//       let minDistance = Infinity;
//       let nearestIndex = 0;
      
//       for (let i = 0; i < routeCoords.length; i++) {
//         const distance = haversine(currentLocation, routeCoords[i]);
//         if (distance < minDistance) {
//           minDistance = distance;
//           nearestIndex = i;
//         }
//       }
      
//       return { index: nearestIndex, distance: minDistance };
//     },
//     []
//   );

//   // Update visible route as driver moves
//   const updateVisibleRoute = useCallback(() => {
//     if (!location || !fullRouteCoords.length || rideStatus !== "started") {
//       return;
//     }
    
//     const nearestPoint = findNearestPointOnRoute(location, fullRouteCoords);
//     if (!nearestPoint) return;
    
//     // Always update the visible route when driver moves
//     const remainingRoute = fullRouteCoords.slice(nearestPoint.index);
   
//     if (remainingRoute.length > 0) {
//       // Add current location to make the route more accurate
//       const updatedRoute = [location, ...remainingRoute];
//       setVisibleRouteCoords(updatedRoute);
//       setNearestPointIndex(nearestPoint.index);
//     }
//   }, [location, fullRouteCoords, rideStatus, findNearestPointOnRoute]);

//   // Throttled route update
//   const throttledUpdateVisibleRoute = useCallback(() => {
//     if (routeUpdateThrottle.current) {
//       clearTimeout(routeUpdateThrottle.current);
//     }
    
//     routeUpdateThrottle.current = setTimeout(() => {
//       updateVisibleRoute();
//     }, 500);
//   }, [updateVisibleRoute]);

//   // Smooth map animation
//   const animateToLocation = useCallback(
//     (targetLocation: LocationType, shouldIncludeUser: boolean = false) => {
//       if (!mapRef.current || mapAnimationInProgress.current) return;
      
//       mapAnimationInProgress.current = true;
//       let region = {
//         latitude: targetLocation.latitude,
//         longitude: targetLocation.longitude,
//         latitudeDelta: 0.01,
//         longitudeDelta: 0.01,
//       };

//       if (shouldIncludeUser && userLocation && location) {
//         const points = [location, userLocation, targetLocation];
//         const lats = points.map((p) => p.latitude);
//         const lngs = points.map((p) => p.longitude);
//         const minLat = Math.min(...lats);
//         const maxLat = Math.max(...lats);
//         const minLng = Math.min(...lngs);
//         const maxLng = Math.max(...lngs);
//         const midLat = (minLat + maxLat) / 2;
//         const midLng = (minLng + maxLng) / 2;
//         const latDelta = (maxLat - minLat) * 1.2;
//         const lngDelta = (maxLng - minLng) * 1.2;
        
//         region = {
//           latitude: midLat,
//           longitude: midLng,
//           latitudeDelta: Math.max(latDelta, 0.02),
//           longitudeDelta: Math.max(lngDelta, 0.02),
//         };
//       }

//       setMapRegion(region);
//       mapRef.current.animateToRegion(region, 1000);
      
//       setTimeout(() => {
//         mapAnimationInProgress.current = false;
//       }, 1000);
//     },
//     [userLocation, location]
//   );

//   // Start navigation (called after OTP verification)
//   const startNavigation = useCallback(async () => {
//     if (!ride?.pickup || !ride?.drop) return;
//     console.log("🚀 Starting navigation from pickup to drop location");
   
//     try {
//       const routeCoords = await fetchRoute(ride.pickup, ride.drop);
//       if (routeCoords && routeCoords.length > 0) {
//         console.log("✅ Navigation route fetched successfully:", routeCoords.length, "points");
       
//         // Set the full route coordinates
//         setFullRouteCoords(routeCoords);
//         setVisibleRouteCoords(routeCoords);
       
//         // Start the navigation interval
//         if (navigationInterval.current) {
//           clearInterval(navigationInterval.current);
//         }
       
//         navigationInterval.current = setInterval(() => {
//           throttledUpdateVisibleRoute();
//         }, 2000);
       
//         console.log("🗺️ Navigation started with route updates from pickup to drop");
//       }
//     } catch (error) {
//       console.error("❌ Error starting navigation:", error);
//     }
//   }, [ride?.pickup, ride?.drop, fetchRoute, throttledUpdateVisibleRoute]);

//   // Stop navigation
//   const stopNavigation = useCallback(() => {
//     console.log("🛑 Stopping navigation mode");
//     if (navigationInterval.current) {
//       clearInterval(navigationInterval.current);
//       navigationInterval.current = null;
//     }
//   }, []);

//   // Logout function
//   const handleLogout = async () => {
//     try {
//       console.log("🚪 Initiating logout for driver:", driverId);
//       await stopLocationTracking();
      
//       // Safely stop background service if function exists
//       if (BackgroundLocationService && typeof BackgroundLocationService.stopBackgroundService === 'function') {
//         try {
//           await BackgroundLocationService.stopBackgroundService();
//           console.log('✅ Background service stopped during logout');
//         } catch (e) {
//           console.warn('Failed to stop background service during logout', e);
//         }
//       }
      
//       await api.post("/drivers/logout");
//       await AsyncStorage.clear();
//       console.log("✅ AsyncStorage cleared");
//       disconnectSocket();
//       navigation.replace("LoginScreen");
//       console.log("🧭 Navigated to LoginScreen");
//     } catch (err) {
//       console.error("❌ Error during logout:", err);
//       Alert.alert("❌ Logout Error", "Failed to logout. Please try again.");
//     }
//   };


//   const acceptRide = async (rideId?: string) => {
//   const currentRideId = rideId || ride?.rideId;
//   if (!currentRideId) {
//     Alert.alert("Error", "No ride ID available. Please try again.");
//     return;
//   }
  
//   if (!driverId) {
//     Alert.alert("Error", "Driver not properly registered.");
//     return;
//   }
  
//   if (!isSocketConnected()) {
//     Alert.alert("Connection Error", "Reconnecting to server...");
//     const socketInstance = connectSocket();
//     socketInstance.connect();
//     socketInstance.once("connect", () => {
//       setTimeout(() => acceptRide(currentRideId), 1000);
//     });
//     return;
//   }
  
//   setIsLoading(true);
//   setRideStatus("accepted");
//   setDriverStatus("onRide");
  
//   const socketInstance = connectSocket();
//   socketInstance.emit(
//     "acceptRide",
//     {
//       rideId: currentRideId,
//       driverId: driverId,
//       driverName: driverName,
//     },
//     async (response: any) => {
//       setIsLoading(false);
//       if (!isMounted.current) return;
      
//       if (response && response.success) {
//         console.log('✅ Ride accepted successfully:', response);
        
//         // 🔧 CRITICAL: Log the OTP received from the backend
//         console.log('🔢 OTP from backend response:', response.otp);
        
//         const userDataWithId = {
//           name: response.userName || "User",
//           mobile: response.userMobile || "N/A",
//           location: {
//             latitude: response.pickup.lat,
//             longitude: response.pickup.lng,
//           },
//           userId: response.userId,
//         };
        
//         setUserData(userDataWithId);
//         const initialUserLocation = {
//           latitude: response.pickup.lat,
//           longitude: response.pickup.lng,
//         };
        
//         setUserLocation(initialUserLocation);
        
//         // 🔧 CRITICAL: Update ride data with the latest information from the backend
//         setRide(prev => ({
//           ...prev,
//           rideId: response.rideId,
//           RAID_ID: response.RAID_ID,
//           otp: response.otp, // Ensure OTP is updated
//           pickup: {
//             latitude: response.pickup.lat,
//             longitude: response.pickup.lng,
//             address: response.pickup.address || "Unknown location",
//           },
//           drop: {
//             latitude: response.drop.lat,
//             longitude: response.drop.lng,
//             address: response.drop.address || "Unknown location",
//           },
//           fare: response.fare,
//           distance: response.distance,
//           userName: response.userName,
//           userMobile: response.userMobile,
//         }));
        
//         if (location) {
//           try {
//             const pickupRoute = await fetchRoute(location, initialUserLocation);
//             if (pickupRoute) {
//               setRide(prev => prev ? { ...prev, routeCoords: pickupRoute } : null);
//               console.log("✅ Driver to pickup route generated");
//             }
//           } catch (error) {
//             console.error("❌ Error generating pickup route:", error);
//           }
         
//           animateToLocation(initialUserLocation, true);
//         }

//         const socketInstance = connectSocket();
//         socketInstance.emit("driverAcceptedRide", {
//           rideId: currentRideId,
//           driverId: driverId,
//           userId: response.userId,
//           driverLocation: location,
//         });
        
//         setTimeout(() => {
//           const socketInstance = connectSocket();
//           socketInstance.emit("getUserDataForDriver", { rideId: currentRideId });
//         }, 1000);
//       } else {
//         console.error('❌ Failed to accept ride:', response);
//         Alert.alert("Error", "Failed to accept ride. Please try again.");
//         setRideStatus("idle");
//         setDriverStatus("online");
//       }
//     }
//   );
// };


// // Add this to your socket event listeners
// const handleRideOTPUpdate = (data: any) => {
//   if (!isMounted.current) return;
//   if (data && data.rideId && data.otp) {
//     console.log('🔢 Received OTP update for ride:', data.rideId, 'OTP:', data.otp);
    
//     // Only update if this is for the current ride
//     if (ride && ride.rideId === data.rideId) {
//       setRide(prev => prev ? { ...prev, otp: data.otp } : null);
//     }
//   }
// };

// // Add this to your socket event listeners setup
// socketInstance.on("rideOTPUpdate", handleRideOTPUpdate);

// // Don't forget to remove the listener in the cleanup
// socketInstance.off("rideOTPUpdate", handleRideOTPUpdate);

// // Add this function to explicitly request OTP
// const requestRideOTP = (rideId: string) => {
//   if (!isSocketConnected()) {
//     console.error('❌ Socket not connected, cannot request OTP');
//     return;
//   }
  
//   console.log('🔢 Requesting OTP for ride:', rideId);
//   const socketInstance = connectSocket();
//   socketInstance.emit("requestRideOTP", { rideId });
// };

// // Call this after accepting the ride
// // In the acceptRide function, after setting the ride status:
// requestRideOTP(currentRideId);



//   // Reject ride
//   const rejectRide = (rideId?: string) => {
//     const currentRideId = rideId || ride?.rideId;
//     if (!currentRideId) return;
    
//     setRide(null);
//     setRideStatus("idle");
//     setDriverStatus("online");
//     setUserData(null);
//     setUserLocation(null);
//     setLastCoord(null);
//     setFullRouteCoords([]);
//     setVisibleRouteCoords([]);
    
//     const socketInstance = connectSocket();
//     socketInstance.emit("rejectRide", {
//       rideId: currentRideId,
//       driverId,
//     });
    
//     Alert.alert("Ride Rejected ❌", "You rejected the ride");
//   };



//   const confirmOTP = async () => {
//   if (!ride) {
//     console.error('❌ No ride data available for OTP confirmation');
//     Alert.alert("Error", "No ride data available. Please try again.");
//     return;
//   }
  
//   if (!ride.otp) {
//     console.error('❌ OTP not available in ride data');
//     Alert.alert("Error", "OTP not yet received. Please wait...");
//     return;
//   }
  
//   // 🔧 ENHANCED OTP VALIDATION
//   const enteredOtpClean = enteredOtp.trim().replace(/\s/g, '');
//   const rideOtpClean = ride.otp.trim().replace(/\s/g, '');
  
//   console.log('🔢 OTP VALIDATION DEBUG:');
//   console.log('📱 Entered OTP:', enteredOtpClean);
//   console.log('📱 Ride OTP:', rideOtpClean);
//   console.log('✅ OTP Match?', enteredOtpClean === rideOtpClean);
  
//   if (enteredOtpClean === rideOtpClean) {
//     // Reset distance tracking and start fresh from OTP verification
//     setTravelledKm(0);
//     distanceSinceOtp.current = 0;
//     lastLocationBeforeOtp.current = location;
    
//     setOtpSharedTime(new Date());
//     setRideStatus("started");
//     setOtpModalVisible(false);
//     setEnteredOtp("");
    
//     console.log("✅ OTP Verified - Starting navigation and distance tracking from pickup location");
    
//     if (ride.pickup && ride.drop) {
//       await startNavigation();
//       animateToLocation(ride.drop, true);
//     }

//     // Notify user that OTP is verified and ride has started
//     const socketInstance = connectSocket();
//     socketInstance.emit("otpVerified", {
//       rideId: ride.rideId,
//       driverId: driverId,
//       userId: userData?.userId,
//       timestamp: new Date().toISOString(),
//       driverLocation: location
//     });

//     const socketInstance2 = connectSocket();
//     socketInstance2.emit("driverStartedRide", {
//       rideId: ride.rideId,
//       driverId: driverId,
//       userId: userData?.userId,
//       driverLocation: location,
//       otpVerified: true,
//       timestamp: new Date().toISOString()
//     });

//     const socketInstance3 = connectSocket();
//     socketInstance3.emit("rideStatusUpdate", {
//       rideId: ride.rideId,
//       status: "started",
//       otpVerified: true,
//       timestamp: new Date().toISOString()
//     });
    
//     console.log("📢 Emitted OTP verification events to user");
    
//     Alert.alert(
//       "OTP Verified ✅",
//       "Navigation from pickup to destination started. Distance tracking began.",
//       [{ text: "OK" }]
//     );
//   } else {
//     console.error('❌ OTP validation failed');
//     Alert.alert(
//       "Invalid OTP ❌", 
//       `Please check the OTP and try again.\n\nExpected: ${rideOtpClean}\nEntered: ${enteredOtpClean}`
//     );
//   }
// };

//   const completeRide = async () => {
//     if (!ride) return;
    
//     stopNavigation();
    
//     try {
//       // Calculate final distance - use the distance since OTP verification
//       const finalDistance = distanceSinceOtp.current;
      
//       // FIX: Use the admin-set fare from the ride object, NOT recalculating
//       let finalFare = ride.fare || 0;
      
//       console.log(`💰 Using admin-set fare: ₹${finalFare} for ${finalDistance.toFixed(2)}km`);
      
//       // Set bill details
//       setBillDetails({
//         distance: `${finalDistance.toFixed(2)} km`,
//         travelTime: `${Math.round(finalDistance * 10)} mins`, // Approximate time
//         charge: Math.round(finalFare),
//         userName: userData?.name || 'Customer',
//         userMobile: userData?.mobile || 'N/A'
//       });
      
//       // Show bill modal
//       setShowBillModal(true);
      
//       // Emit ride completion to server
//       const socketInstance = connectSocket();
//       socketInstance.emit("driverCompletedRide", {
//         rideId: ride.rideId,
//         driverId: driverId,
//         userId: userData?.userId,
//         distance: finalDistance,
//         fare: finalFare
//       });
      
//       const socketInstance2 = connectSocket();
//       socketInstance2.emit("completeRide", {
//         rideId: ride.rideId,
//         driverId,
//         distance: finalDistance,
//         fare: finalFare // Use the admin-set fare
//       });
      
//     } catch (error) {
//       console.error("❌ Error completing ride:", error);
//       Alert.alert("Error", "Failed to complete ride. Please try again.");
//     }
//   };

//   // Handle bill modal close
//   const handleBillModalClose = () => {
//     setShowBillModal(false);
//     setRideStatus("completed");
//     setDriverStatus("online");
    
//     // Reset all ride states
//     setRide(null);
//     setTravelledKm(0);
//     setUserData(null);
//     setUserLocation(null);
//     setLastCoord(null);
//     setFullRouteCoords([]);
//     setVisibleRouteCoords([]);
//     setNearestPointIndex(0);
//     setOtpSharedTime(null);
//     distanceSinceOtp.current = 0;
//     lastLocationBeforeOtp.current = null;
//   };

//   // Handle verification modal close
//   const handleVerificationModalClose = () => {
//     setShowVerificationModal(false);
//   };

//   // Handle ride requests count
//   const handleRideRequest = (data: any) => {
//     if (!isMounted.current || !data?.rideId) return;
    
//     // Increment total rides received
//     setSessionStats(prev => ({
//       ...prev,
//       totalRidesReceived: prev.totalRidesReceived + 1
//     }));
    
//     // Your existing ride request handling code...
//     try {
//       const rideData: RideType = {
//         rideId: data.rideId,
//         RAID_ID: data.RAID_ID || "N/A",
//         otp: data.otp || "0000",
//         pickup: {
//           latitude: data.pickup?.lat || data.pickup?.latitude || 0,
//           longitude: data.pickup?.lng || data.pickup?.longitude || 0,
//           address: data.pickup?.address || "Unknown location",
//         },
//         drop: {
//           latitude: data.drop?.lat || data.drop?.latitude || 0,
//           longitude: data.drop?.lng || data.drop?.longitude || 0,
//           address: data.drop?.address || "Unknown location",
//         },
//         fare: data.fare || 0,
//         distance: data.distance || "0 km",
//         userName: data.userName || "Customer",
//         userMobile: data.userMobile || "N/A",
//       };
      
//       setRide(rideData);
//       setRideStatus("onTheWay");
      
//       Alert.alert(
//         "🚖 New Ride Request!",
//         `📍 Pickup: ${rideData.pickup.address}\n🎯 Drop: ${rideData.drop.address}\n💰 Fare: ₹${rideData.fare}\n📏 Distance: ${rideData.distance}\n👤 Customer: ${rideData.userName}`,
//         [
//           {
//             text: "❌ Reject",
//             onPress: () => {
//               setSessionStats(prev => ({
//                 ...prev,
//                 ridesMissed: prev.ridesMissed + 1
//               }));
//               rejectRide(rideData.rideId);
//             },
//             style: "destructive",
//           },
//           {
//             text: "✅ Accept",
//             onPress: () => {
//               setSessionStats(prev => ({
//                 ...prev,
//                 yourRides: prev.yourRides + 1
//               }));
//               acceptRide(rideData.rideId);
//             },
//           },
//         ],
//         { cancelable: false }
//       );
//     } catch (error) {
//       console.error("❌ Error processing ride request:", error);
//       Alert.alert("Error", "Could not process ride request. Please try again.");
//     }
//   };

//   // Session Summary Modal
//   const SessionSummaryModal = () => (
//     <Modal
//       animationType="slide"
//       transparent={true}
//       visible={showSessionSummary}
//       onRequestClose={() => setShowSessionSummary(false)}
//     >
//       <View style={styles.modalContainer}>
//         <View style={styles.modalContent}>
//           <View style={styles.modalHeader}>
//             <Text style={styles.modalTitle}>EAZY GO</Text>
//             <TouchableOpacity onPress={() => setShowSessionSummary(false)}>
//               <MaterialIcons name="close" size={24} color="#666" />
//             </TouchableOpacity>
//           </View>
          
//           <View style={styles.modalIconContainer}>
//             <FontAwesome name="calendar-check" size={50} color="#4CAF50" />
//           </View>
          
//           <View style={styles.sessionSummaryContainer}>
//             <View style={styles.sessionRow}>
//               <Text style={styles.sessionLabel}>Today's login time:</Text>
//               <Text style={styles.sessionValue}>
//                 {sessionStats.loginTime ? formatTime(sessionStats.loginTime) : 'N/A'}
//               </Text>
//             </View>
//             <View style={styles.sessionRow}>
//               <Text style={styles.sessionLabel}>Total online duration:</Text>
//               <Text style={styles.sessionValue}>{formatDuration(onlineDuration)}</Text>
//             </View>
//             <View style={styles.sessionRow}>
//               <Text style={styles.sessionLabel}>Total rides received:</Text>
//               <Text style={styles.sessionValue}>{sessionStats.totalRidesReceived}</Text>
//             </View>
//             <View style={styles.sessionRow}>
//               <Text style={styles.sessionLabel}>Your rides:</Text>
//               <Text style={styles.sessionValue}>{sessionStats.yourRides}</Text>
//             </View>
//             <View style={styles.sessionRow}>
//               <Text style={styles.sessionLabel}>Rides missed:</Text>
//               <Text style={styles.sessionValue}>{sessionStats.ridesMissed}</Text>
//             </View>
//             <View style={styles.sessionDivider} />
//             <View style={styles.sessionRow}>
//               <Text style={styles.sessionTotalLabel}>Earnings:</Text>
//               <Text style={styles.sessionTotalValue}>₹{sessionStats.earnings}</Text>
//             </View>
//           </View>
          


//           <TouchableOpacity
//   style={[styles.button, {backgroundColor: 'purple', margin: 8}]}
//   onPress={testNotification}
// >
//   <Text style={styles.btnText}>Test Notification</Text>
// </TouchableOpacity>


//           <TouchableOpacity
//             style={styles.modalConfirmButton}
//             onPress={() => {
//               setShowSessionSummary(false);
//               // Reset session for next time
//               setSessionStats({
//                 loginTime: null,
//                 totalRidesReceived: 0,
//                 yourRides: 0,
//                 ridesMissed: 0,
//                 earnings: 0
//               });
//               setOnlineDuration(0);
//               saveSessionData({
//                 loginTime: null,
//                 totalRidesReceived: 0,
//                 yourRides: 0,
//                 ridesMissed: 0,
//                 earnings: 0
//               });
//             }}
//           >
//             <Text style={styles.modalConfirmButtonText}>OK</Text>
//           </TouchableOpacity>
//         </View>
//       </View>
//     </Modal>
//   );

//   // Cleanup on unmount - Enhanced
//   useEffect(() => {
//     return () => {
//       isMounted.current = false;
//       stopLocationTracking();
      
//       if (navigationInterval.current) {
//         clearInterval(navigationInterval.current);
//       }
//       if (routeUpdateThrottle.current) {
//         clearTimeout(routeUpdateThrottle.current);
//       }
//     };
//   }, []);

//   // Socket event listeners
//   useEffect(() => {
//     const handleConnect = () => {
//       if (!isMounted.current) return;
//       setSocketConnected(true);
      
//       if (location && driverId && driverStatus === 'online') {
//         const socketInstance = connectSocket();
//         socketInstance.emit("registerDriver", {
//           driverId,
//           driverName,
//           latitude: location.latitude,
//           longitude: location.longitude,
//           vehicleType: "taxi",
//         });
//         setIsRegistered(true);
//       }
//     };


//     const handleNewRideRequest = (data: any) => {
//   if (!isMounted.current || !data?.rideId) return;
  
//   // 🔍 DEBUG: Check OTP in received data
//   console.log('🚖 RECEIVED RIDE REQUEST DATA:');
//   console.log('🔢 OTP in request:', data.otp);
//   console.log('🔢 OTP type:', typeof data.otp);
//   console.log('🔢 OTP length:', data.otp?.length);
//   console.log('📦 Full ride data:', data);
  
//   // Increment total rides received
//   setSessionStats(prev => ({
//     ...prev,
//     totalRidesReceived: prev.totalRidesReceived + 1
//   }));
  
//   try {
//     // 🔧 IMPROVED: Don't default to "0000", log warning instead
//     if (!data.otp) {
//       console.warn('⚠️ No OTP provided in ride request');
//     }
    
//     const rideData: RideType = {
//       rideId: data.rideId,
//       RAID_ID: data.RAID_ID || "N/A",
//       otp: data.otp || "", // Don't default to "0000"
//       pickup: {
//         latitude: data.pickup?.lat || data.pickup?.latitude || 0,
//         longitude: data.pickup?.lng || data.pickup?.longitude || 0,
//         address: data.pickup?.address || "Unknown location",
//       },
//       drop: {
//         latitude: data.drop?.lat || data.drop?.latitude || 0,
//         longitude: data.drop?.lng || data.drop?.longitude || 0,
//         address: data.drop?.address || "Unknown location",
//       },
//       fare: data.fare || 0,
//       distance: data.distance || "0 km",
//       userName: data.userName || "Customer",
//       userMobile: data.userMobile || "N/A",
//     };
    
//     console.log('🔢 Final OTP stored in ride:', rideData.otp);
    
//     setRide(rideData);
//     setRideStatus("onTheWay");
    
//     Alert.alert(
//       "🚖 New Ride Request!",
//       `📍 Pickup: ${rideData.pickup.address}\n🎯 Drop: ${rideData.drop.address}\n💰 Fare: ₹${rideData.fare}\n📏 Distance: ${rideData.distance}\n👤 Customer: ${rideData.userName}\n🔢 OTP: ${rideData.otp}`,
//       [
//         {
//           text: "❌ Reject",
//           onPress: () => {
//             setSessionStats(prev => ({
//               ...prev,
//               ridesMissed: prev.ridesMissed + 1
//             }));
//             rejectRide(rideData.rideId);
//           },
//           style: "destructive",
//         },
//         {
//           text: "✅ Accept",
//           onPress: () => {
//             setSessionStats(prev => ({
//               ...prev,
//               yourRides: prev.yourRides + 1
//             }));
//             acceptRide(rideData.rideId);
//           },
//         },
//       ],
//       { cancelable: false }
//     );
//   } catch (error) {
//     console.error("❌ Error processing ride request:", error);
//     Alert.alert("Error", "Could not process ride request. Please try again.");
//   }
// };
//     const handleUserLiveLocationUpdate = (data: any) => {
//       if (!isMounted.current) return;
//       if (data && data.latitude && data.longitude) {
//         setUserLocation({
//           latitude: data.latitude,
//           longitude: data.longitude,
//         });
//       }
//     };

//     const handleUserDataForDriver = (data: any) => {
//       if (!isMounted.current) return;
//       if (data && data.latitude && data.longitude) {
//         setUserLocation({
//           latitude: data.latitude,
//           longitude: data.longitude,
//         });
//       }
//     };

//     const handleRideOTP = (data: any) => {
//       if (!isMounted.current) return;
//       if (data && data.otp) {
//         setRide((prev) => prev ? { ...prev, otp: data.otp } : null);
//       }
//     };

//     const handleDisconnect = () => {
//       if (!isMounted.current) return;
//       setSocketConnected(false);
//     };

//     const handleConnectError = (error: any) => {
//       if (!isMounted.current) return;
//       console.error("Socket connection error:", error);
//       setSocketConnected(false);
//     };

//     const handleRideCancelled = (data: any) => {
//       if (!isMounted.current) return;
//       if (data && data.rideId === ride?.rideId) {
//         Alert.alert("Ride Cancelled", "The passenger has cancelled the ride.");
//         setRide(null);
//         setRideStatus("idle");
//         setDriverStatus("online");
//         setUserData(null);
//         setUserLocation(null);
//         setFullRouteCoords([]);
//         setVisibleRouteCoords([]);
//       }
//     };

//     const handleRideAlreadyAccepted = (data: any) => {
//       if (!isMounted.current) return;
//       if (data && data.rideId === ride?.rideId) {
//         Alert.alert("Ride Already Accepted", "This ride has already been accepted by another driver.");
//         setRide(null);
//         setRideStatus("idle");
//         setDriverStatus("online");
//         setUserData(null);
//         setUserLocation(null);
//         setFullRouteCoords([]);
//         setVisibleRouteCoords([]);
//       }
//     };

//     const handleRideStarted = (data: any) => {
//       if (!isMounted.current) return;
//       if (data && data.rideId === ride?.rideId) {
//         setRideStatus("started");
//       }
//     };

//     const handleEarningsUpdate = (data: any) => {
//       if (!isMounted.current) return;
//       if (data && data.earnings !== undefined) {
//         setSessionStats(prev => ({
//           ...prev,
//           earnings: prev.earnings + data.earnings
//         }));
//         saveSessionData({
//           ...sessionStats,
//           earnings: sessionStats.earnings + data.earnings
//         });
//       }
//     };

//     // Get socket instance and attach event listeners
//     const socketInstance = connectSocket();
    
//     socketInstance.on("connect", handleConnect);
//     socketInstance.on("newRideRequest", handleNewRideRequest);
//     socketInstance.on("userLiveLocationUpdate", handleUserLiveLocationUpdate);
//     socketInstance.on("userDataForDriver", handleUserDataForDriver);
//     socketInstance.on("rideOTP", handleRideOTP);
//     socketInstance.on("disconnect", handleDisconnect);
//     socketInstance.on("connect_error", handleConnectError);
//     socketInstance.on("rideCancelled", handleRideCancelled);
//     socketInstance.on("rideAlreadyAccepted", handleRideAlreadyAccepted);
//     socketInstance.on("rideStarted", handleRideStarted);
//     socketInstance.on("rideEarningsUpdate", handleEarningsUpdate);
    
//     return () => {
//       socketInstance.off("connect", handleConnect);
//       socketInstance.off("newRideRequest", handleNewRideRequest);
//       socketInstance.off("userLiveLocationUpdate", handleUserLiveLocationUpdate);
//       socketInstance.off("userDataForDriver", handleUserDataForDriver);
//       socketInstance.off("rideOTP", handleRideOTP);
//       socketInstance.off("disconnect", handleDisconnect);
//       socketInstance.off("connect_error", handleConnectError);
//       socketInstance.off("rideCancelled", handleRideCancelled);
//       socketInstance.off("rideAlreadyAccepted", handleRideAlreadyAccepted);
//       socketInstance.off("rideStarted", handleRideStarted);
//       socketInstance.off("rideEarningsUpdate", handleEarningsUpdate);
//     };
//   }, [location, driverId, driverName, ride, rideStatus, userData, stopNavigation, currentSpeed]);

//   // UI Rendering
//   if (error) {
//     return (
//       <View style={styles.errorContainer}>
//         <Text style={styles.errorText}>{error}</Text>
//         <TouchableOpacity
//           style={styles.retryButton}
//           onPress={() => setError(null)}
//         >
//           <Text style={styles.retryText}>Retry</Text>
//         </TouchableOpacity>
//       </View>
//     );
//   }

//   if (!location && driverStatus !== 'offline') {
//     return (
//       <View style={styles.loadingContainer}>
//         <ActivityIndicator size="large" color="#4caf50" />
//         <Text style={styles.loadingText}>Fetching your location...</Text>
//         <TouchableOpacity
//           style={styles.retryButton}
//           onPress={() => {
//             Geolocation.getCurrentPosition(
//               (pos) => {
//                 setLocation({
//                   latitude: pos.coords.latitude,
//                   longitude: pos.coords.longitude,
//                 });
//               },
//               (err) => {
//                 Alert.alert(
//                   "Location Error",
//                   "Could not get your location. Please check GPS settings."
//                 );
//               },
//               { enableHighAccuracy: true, timeout: 15000 }
//             );
//           }}
//         >
//           <Text style={styles.retryText}>Retry Location</Text>
//         </TouchableOpacity>
//       </View>
//     );
//   }

//   return (
//     <View style={styles.container}>
//       <MapView
//         ref={mapRef}
//         style={styles.map}
//         initialRegion={{
//           latitude: location?.latitude || 0,
//           longitude: location?.longitude || 0,
//           latitudeDelta: 0.01,
//           longitudeDelta: 0.01,
//         }}
//         showsUserLocation
//         showsMyLocationButton
//         showsCompass={true}
//         showsScale={true}
//         zoomControlEnabled={true}
//         rotateEnabled={true}
//         scrollEnabled={true}
//         zoomEnabled={true}
//         region={mapRegion}
//       >
//         {ride && (
//           <Marker
//             coordinate={ride.pickup}
//             title="Pickup Location"
//             description={ride.pickup.address}
//             pinColor="blue"
//           />
//         )}
        
//         {ride && (
//           <Marker
//             coordinate={ride.drop}
//             title="Drop Location"
//             description={ride.drop.address}
//             pinColor="red"
//           />
//         )}
       
//         {/* RED ROUTE - Show after OTP verification (ride started) */}
//         {rideStatus === "started" && visibleRouteCoords.length > 0 && (
//           <Polyline
//             coordinates={visibleRouteCoords}
//             strokeWidth={6}
//             strokeColor="#F44336"
//             lineCap="round"
//             lineJoin="round"
//           />
//         )}
       
//         {/* GREEN ROUTE - Show from driver to pickup location (before OTP) */}
//         {rideStatus === "accepted" && ride?.routeCoords && ride.routeCoords.length > 0 && (
//           <Polyline
//             coordinates={ride.routeCoords}
//             strokeWidth={4}
//             strokeColor="#4caf50"
//             lineCap="round"
//             lineJoin="round"
//           />
//         )}
       
//         {ride && (rideStatus === "accepted" || rideStatus === "started") && userLocation && (
//           <Marker
//             coordinate={userLocation}
//             title="User Live Location"
//             description={`${userData?.name || "User"} - Live Location`}
//             tracksViewChanges={false}
//           >
//             <View style={styles.blackDotMarker}>
//               <View style={styles.blackDotInner} />
//             </View>
//           </Marker>
//         )}
//       </MapView>

//       {/* Online/Offline Toggle and Session Info */}
//       <View style={styles.headerContainer}>
//         <TouchableOpacity
//           style={[
//             styles.onlineToggle,
//             driverStatus === 'online' || driverStatus === 'onRide' 
//               ? styles.onlineToggleActive 
//               : styles.onlineToggleInactive
//           ]}
//           onPress={driverStatus === 'offline' ? goOnline : goOffline}
//         >
//           <Text style={styles.onlineToggleText}>
//             {driverStatus === 'offline' ? 'Go Online' : 'Go Offline'}
//           </Text>
//         </TouchableOpacity>

//         {(driverStatus === 'online' || driverStatus === 'onRide') && (
//           <View style={styles.sessionInfo}>
//             <Text style={styles.sessionText}>
//               Login: {sessionStats.loginTime ? formatTime(sessionStats.loginTime) : 'N/A'}
//             </Text>
//             <Text style={styles.sessionText}>
//               Active: {formatDuration(onlineDuration)}
//             </Text>
//             {isBackgroundMode && (
//               <Text style={styles.backgroundIndicator}>🔴 Background Active</Text>
//             )}
//           </View>
//         )}
//       </View>

//       <View style={styles.statusContainer}>
//         <View style={styles.statusRow}>
//           <View
//             style={[
//               styles.statusIndicator,
//               { backgroundColor: socketConnected ? "#4caf50" : "#f44336" },
//             ]}
//           />
//           <Text style={styles.statusText}>
//             {socketConnected ? "Connected" : "Disconnected"}
//           </Text>
//           <View
//             style={[
//               styles.statusIndicator,
//               {
//                 backgroundColor:
//                   driverStatus === "online"
//                     ? "#4caf50"
//                     : driverStatus === "onRide"
//                     ? "#ff9800"
//                     : "#f44336",
//               },
//             ]}
//           />
//           <Text style={styles.statusText}>{driverStatus.toUpperCase()}</Text>
//         </View>
        
//         {ride && (rideStatus === "accepted" || rideStatus === "started") && userLocation && (
//           <Text style={styles.userLocationText}>
//             🟢 User Live: {userLocation.latitude.toFixed(4)},{" "}
//             {userLocation.longitude.toFixed(4)}
//           </Text>
//         )}
        
//         {rideStatus === "started" && (
//           <Text style={styles.distanceText}>
//             📏 Distance Travelled: {travelledKm.toFixed(2)} km
//           </Text>
//         )}
//       </View>

//       {ride && (rideStatus === "accepted" || rideStatus === "started") && userData && (
//         <View style={styles.userDataContainer}>
//           <Text style={styles.userDataTitle}>Passenger Details</Text>
//           <View style={styles.userInfoRow}>
//             <Text style={styles.userInfoLabel}>Name:</Text>
//             <Text style={styles.userInfoValue}>{userData.name}</Text>
//           </View>
//           <View style={styles.userInfoRow}>
//             <Text style={styles.userInfoLabel}>Mobile:</Text>
//             <Text style={styles.userInfoValue}>{userData.mobile}</Text>
//           </View>
//           <View style={styles.userInfoRow}>
//             <Text style={styles.userInfoLabel}>Pickup:</Text>
//             <Text style={styles.userInfoValue} numberOfLines={2}>
//               {ride.pickup.address}
//             </Text>
//           </View>
//           <View style={styles.userInfoRow}>
//             <Text style={styles.userInfoLabel}>Drop:</Text>
//             <Text style={styles.userInfoValue} numberOfLines={2}>
//               {ride.drop.address}
//             </Text>
//           </View>
//           {userLocation && (
//             <View style={styles.liveStatus}>
//               <View style={styles.liveDot} />
//               <Text style={styles.liveText}>LIVE LOCATION TRACKING ACTIVE</Text>
//             </View>
//           )}
//         </View>
//       )}

//       {ride && rideStatus === "onTheWay" && (
//         <View style={styles.rideActions}>
//           <TouchableOpacity
//             style={[styles.button, styles.acceptButton]}
//             onPress={() => acceptRide()}
//             disabled={isLoading}
//           >
//             {isLoading ? (
//               <ActivityIndicator color="#fff" size="small" />
//             ) : (
//               <Text style={styles.btnText}>Accept Ride</Text>
//             )}
//           </TouchableOpacity>
//           <TouchableOpacity
//             style={[styles.button, styles.rejectButton]}
//             onPress={() => rejectRide()}
//           >
//             <Text style={styles.btnText}>Reject</Text>
//           </TouchableOpacity>
//         </View>
//       )}

//       {ride && rideStatus === "accepted" && (
//         <TouchableOpacity
//           style={[styles.button, styles.startButton]}
//           onPress={() => setOtpModalVisible(true)}
//         >
//           <Text style={styles.btnText}>Enter OTP & Start Ride</Text>
//         </TouchableOpacity>
//       )}

//       {ride && rideStatus === "started" && (
//         <TouchableOpacity
//           style={[styles.button, styles.completeButton]}
//           onPress={completeRide}
//         >
//           <Text style={styles.btnText}>
//             Complete Ride ({distanceSinceOtp.current.toFixed(2)} km)
//           </Text>
//         </TouchableOpacity>
//       )}

//       {/* Logout Button */}
//       {!ride && (
//         <TouchableOpacity
//           style={[styles.button, styles.logoutButton]}
//           onPress={handleLogout}
//         >
//           <Text style={styles.btnText}>Logout</Text>
//         </TouchableOpacity>
//       )}

//       {/* OTP Modal */}
//       <Modal visible={otpModalVisible} transparent animationType="slide">
//         <View style={styles.modalContainer}>
//           <View style={styles.modalContent}>
//             <Text style={styles.modalTitle}>Enter OTP</Text>
//             <Text style={styles.modalSubtitle}>Please ask passenger for OTP</Text>
//             <TextInput
//               placeholder="Enter 4-digit OTP"
//               value={enteredOtp}
//               onChangeText={setEnteredOtp}
//               keyboardType="numeric"
//               style={styles.input}
//               maxLength={4}
//               autoFocus
//             />
//             <View style={styles.modalButtons}>
//               <TouchableOpacity
//                 style={[styles.button, styles.cancelButton]}
//                 onPress={() => setOtpModalVisible(false)}
//               >
//                 <Text style={styles.btnText}>Cancel</Text>
//               </TouchableOpacity>
//               <TouchableOpacity
//                 style={[styles.button, styles.confirmButton]}
//                 onPress={confirmOTP}
//               >
//                 <Text style={styles.btnText}>Confirm OTP</Text>
//               </TouchableOpacity>
//             </View>
//           </View>
//         </View>
//       </Modal>

//       {/* Verification Modal */}
//       <Modal
//         animationType="slide"
//         transparent={true}
//         visible={showVerificationModal}
//         onRequestClose={handleVerificationModalClose}
//       >
//         <View style={styles.modalContainer}>
//           <View style={styles.modalContent}>
//             <View style={styles.modalHeader}>
//               <Text style={styles.modalTitle}>Driver Verified Successfully!</Text>
//               <TouchableOpacity onPress={handleVerificationModalClose}>
//                 <MaterialIcons name="close" size={24} color="#666" />
//               </TouchableOpacity>
//             </View>
            
//             <View style={styles.modalIconContainer}>
//               <FontAwesome name="check-circle" size={60} color="#4CAF50" />
//             </View>
            
//             <Text style={styles.modalMessage}>
//               Good news! You have successfully verified your driver.
//             </Text>
            
//             <View style={styles.billDetailsContainer}>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Pickup location:</Text>
//                 <Text style={styles.billValue}>{verificationDetails.pickup}</Text>
//               </View>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Drop-off location:</Text>
//                 <Text style={styles.billValue}>{verificationDetails.dropoff}</Text>
//               </View>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Time:</Text>
//                 <Text style={styles.billValue}>{verificationDetails.time}</Text>
//               </View>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Speed:</Text>
//                 <Text style={styles.billValue}>{verificationDetails.speed.toFixed(2)} km/h</Text>
//               </View>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Distance:</Text>
//                 <Text style={styles.billValue}>{verificationDetails.distance.toFixed(2)} km</Text>
//               </View>
//             </View>
            
//             <TouchableOpacity
//               style={styles.modalConfirmButton}
//               onPress={handleVerificationModalClose}
//             >
//               <Text style={styles.modalConfirmButtonText}>OK</Text>
//             </TouchableOpacity>


// <TouchableOpacity
//   style={[styles.button, {backgroundColor: 'purple', margin: 8}]}
//   onPress={async () => {
//     console.log('🔄 Manual FCM token refresh...');
//     const success = await forceRefreshFCM();
//     Alert.alert('FCM Token', success ? '✅ Token refreshed successfully' : '❌ Failed to refresh token');
//   }}
// >
//   <Text style={styles.btnText}>Refresh FCM Token</Text>
// </TouchableOpacity>

// <TouchableOpacity
//   style={[styles.button, {backgroundColor: 'orange', margin: 8}]}
//   onPress={testLocalNotificationImmediate}
// >
//   <Text style={styles.btnText}>Test System Notification</Text>
// </TouchableOpacity>


// <TouchableOpacity
//   style={[styles.button, {backgroundColor: 'blue', margin: 8}]}
//   onPress={testFullFCMFlow}
// >
//   <Text style={styles.btnText}>Test FCM Flow</Text>
// </TouchableOpacity>



//           </View>
//         </View>
//       </Modal>

//       {/* Bill Modal */}
//       <Modal
//         animationType="slide"
//         transparent={true}
//         visible={showBillModal}
//         onRequestClose={handleBillModalClose}
//       >
//         <View style={styles.modalContainer}>
//           <View style={styles.modalContent}>
//             <View style={styles.modalHeader}>
//               <Text style={styles.modalTitle}>Ride Completed</Text>
//               <TouchableOpacity onPress={handleBillModalClose}>
//                 <MaterialIcons name="close" size={24} color="#666" />
//               </TouchableOpacity>
//             </View>
            
//             <View style={styles.modalIconContainer}>
//               <FontAwesome name="receipt" size={60} color="#4CAF50" />
//             </View>
            
//             <Text style={styles.modalMessage}>
//               Thank you for completing the ride!
//             </Text>
            
//             <View style={styles.billDetailsContainer}>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Customer Name:</Text>
//                 <Text style={styles.billValue}>{billDetails.userName}</Text>
//               </View>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Mobile:</Text>
//                 <Text style={styles.billValue}>{billDetails.userMobile}</Text>
//               </View>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Distance:</Text>
//                 <Text style={styles.billValue}>{billDetails.distance}</Text>
//               </View>
//               <View style={styles.billRow}>
//                 <Text style={styles.billLabel}>Travel Time:</Text>
//                 <Text style={styles.billValue}>{billDetails.travelTime}</Text>
//               </View>
//               <View style={styles.billDivider} />
//               <View style={styles.billRow}>
//                 <Text style={styles.billTotalLabel}>Total Amount:</Text>
//                 <Text style={styles.billTotalValue}>₹{billDetails.charge}</Text>
//               </View>
//             </View>
            
//             <TouchableOpacity
//               style={styles.modalConfirmButton}
//               onPress={handleBillModalClose}
//             >
//               <Text style={styles.modalConfirmButtonText}>OK</Text>
//             </TouchableOpacity>


//             // Add this button near the online/offline toggle
// <TouchableOpacity
//   style={[styles.button, { backgroundColor: 'purple', margin: 8 }]}
//   onPress={async () => {
//     console.log('🔄 Manual token refresh...');
//     const token = await NotificationService.getFCMToken();
//     if (token) {
//       const updated = await sendFCMTokenToServer(token);
//       Alert.alert('Token Refresh', updated ? 'Success' : 'Failed');
//     } else {
//       Alert.alert('Token Refresh', 'No token available');
//     }
//   }}
// >
//   <Text style={styles.btnText}>Refresh FCM Token</Text>
// </TouchableOpacity>


//           </View>
//         </View>
//       </Modal>

//       {/* Session Summary Modal */}
//       <SessionSummaryModal />
//     </View>
//   );
// };

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: "#f8f9fa",
//   },
//   map: {
//     flex: 1,
//   },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: "#ffffff",
//     padding: 20,
//   },
//   loadingText: {
//     marginTop: 16,
//     fontSize: 16,
//     color: "#666",
//     textAlign: "center",
//   },
//   headerContainer: {
//     position: "absolute",
//     top: Platform.OS === "ios" ? 50 : 40,
//     left: 16,
//     right: 16,
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "flex-start",
//   },
//   onlineToggle: {
//     paddingHorizontal: 20,
//     paddingVertical: 10,
//     borderRadius: 20,
//     elevation: 4,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//   },
//   onlineToggleActive: {
//     backgroundColor: "#dc3545",
//   },
//   onlineToggleInactive: {
//     backgroundColor: "#4caf50",
//   },
//   onlineToggleText: {
//     color: "#fff",
//     fontWeight: "600",
//     fontSize: 14,
//   },
//   sessionInfo: {
//     backgroundColor: "rgba(255, 255, 255, 0.95)",
//     padding: 12,
//     borderRadius: 12,
//     elevation: 4,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//     alignItems: "flex-end",
//     maxWidth: 150,
//   },
//   sessionText: {
//     fontSize: 12,
//     fontWeight: "600",
//     color: "#333",
//     marginBottom: 2,
//   },
//   backgroundIndicator: {
//     fontSize: 10,
//     color: "#f44336",
//     fontWeight: "500",
//     marginTop: 4,
//   },
//   statusContainer: {
//     position: "absolute",
//     top: Platform.OS === "ios" ? 120 : 110,
//     left: 16,
//     right: 16,
//     backgroundColor: "rgba(255, 255, 255, 0.95)",
//     padding: 12,
//     borderRadius: 12,
//     elevation: 4,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//   },
//   statusRow: {
//     flexDirection: "row",
//     alignItems: "center",
//     marginBottom: 4,
//   },
//   statusIndicator: {
//     width: 8,
//     height: 8,
//     borderRadius: 4,
//     marginRight: 6,
//   },
//   statusText: {
//     fontSize: 13,
//     fontWeight: "600",
//     marginRight: 16,
//     color: "#333",
//   },
//   userLocationText: {
//     fontSize: 11,
//     color: "#4caf50",
//     fontWeight: "500",
//     marginTop: 2,
//   },
//   distanceText: {
//     fontSize: 11,
//     color: "#ff9800",
//     fontWeight: "500",
//     marginTop: 2,
//   },
//   rideActions: {
//     position: "absolute",
//     bottom: 20,
//     left: 16,
//     right: 16,
//     flexDirection: "row",
//     justifyContent: "space-between",
//     gap: 12,
//   },
//   button: {
//     padding: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     elevation: 3,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//     flex: 1,
//   },
//   acceptButton: {
//     backgroundColor: "#4caf50",
//   },
//   rejectButton: {
//     backgroundColor: "#f44336",
//   },
//   startButton: {
//     backgroundColor: "#2196f3",
//     margin: 16,
//     position: "absolute",
//     bottom: 20,
//     left: 16,
//     right: 16,
//   },
//   completeButton: {
//     backgroundColor: "#ff9800",
//     margin: 16,
//     position: "absolute",
//     bottom: 20,
//     left: 16,
//     right: 16,
//   },
//   cancelButton: {
//     backgroundColor: "#757575",
//   },
//   confirmButton: {
//     backgroundColor: "#4caf50",
//   },
//   logoutButton: {
//     backgroundColor: "#dc3545",
//     margin: 16,
//     position: "absolute",
//     bottom: 20,
//     left: 16,
//     right: 16,
//   },
//   btnText: {
//     color: "#fff",
//     fontWeight: "600",
//     fontSize: 15,
//   },
//   modalContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: "rgba(0,0,0,0.6)",
//     padding: 20,
//   },
//   modalContent: {
//     backgroundColor: "white",
//     padding: 24,
//     borderRadius: 16,
//     width: "100%",
//     elevation: 8,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.2,
//     shadowRadius: 8,
//   },
//   modalHeader: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     marginBottom: 20,
//   },
//   modalTitle: {
//     fontSize: 22,
//     fontWeight: "700",
//     textAlign: "center",
//     color: "#333",
//   },
//   modalSubtitle: {
//     fontSize: 14,
//     color: "#666",
//     textAlign: "center",
//     marginBottom: 20,
//   },
//   input: {
//     borderWidth: 2,
//     borderColor: "#e0e0e0",
//     borderRadius: 8,
//     marginVertical: 16,
//     padding: 16,
//     fontSize: 18,
//     textAlign: "center",
//     fontWeight: "600",
//     backgroundColor: "#f8f9fa",
//   },
//   modalButtons: {
//     flexDirection: "row",
//     marginTop: 8,
//     gap: 12,
//   },
//   errorContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     backgroundColor: "#ffffff",
//     padding: 20,
//   },
//   errorText: {
//     fontSize: 16,
//     color: "#f44336",
//     marginBottom: 20,
//     textAlign: "center",
//     lineHeight: 22,
//   },
//   retryButton: {
//     backgroundColor: "#4caf50",
//     paddingVertical: 12,
//     paddingHorizontal: 24,
//     borderRadius: 8,
//     elevation: 2,
//   },
//   retryText: {
//     color: "#fff",
//     fontWeight: "600",
//     fontSize: 15,
//   },
//   blackDotMarker: {
//     backgroundColor: "rgba(0, 0, 0, 0.9)",
//     width: 24,
//     height: 24,
//     borderRadius: 12,
//     justifyContent: "center",
//     alignItems: "center",
//     borderWidth: 3,
//     borderColor: "#FFFFFF",
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 3 },
//     shadowOpacity: 0.3,
//     shadowRadius: 4,
//     elevation: 6,
//   },
//   blackDotInner: {
//     backgroundColor: "#000000",
//     width: 12,
//     height: 12,
//     borderRadius: 6,
//   },
//   userDataContainer: {
//     position: "absolute",
//     bottom: 80,
//     left: 16,
//     right: 16,
//     backgroundColor: "#FFFFFF",
//     padding: 16,
//     borderRadius: 16,
//     elevation: 6,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.15,
//     shadowRadius: 8,
//   },
//   userDataTitle: {
//     fontSize: 18,
//     fontWeight: "700",
//     marginBottom: 12,
//     color: "#333",
//   },
//   userInfoRow: {
//     flexDirection: "row",
//     alignItems: "flex-start",
//     marginBottom: 8,
//   },
//   userInfoLabel: {
//     fontSize: 14,
//     fontWeight: "600",
//     color: "#666",
//     width: 60,
//     marginRight: 8,
//   },
//   userInfoValue: {
//     fontSize: 14,
//     color: "#333",
//     flex: 1,
//     lineHeight: 20,
//   },
//   liveStatus: {
//     flexDirection: "row",
//     alignItems: "center",
//     marginTop: 8,
//     paddingTop: 8,
//     borderTopWidth: 1,
//     borderTopColor: "#e0e0e0",
//   },
//   liveDot: {
//     width: 8,
//     height: 8,
//     borderRadius: 4,
//     backgroundColor: "#4caf50",
//     marginRight: 8,
//   },
//   liveText: {
//     fontSize: 12,
//     fontWeight: "600",
//     color: "#4caf50",
//   },
//   modalIconContainer: {
//     alignItems: "center",
//     marginBottom: 15,
//   },
//   modalMessage: {
//     fontSize: 16,
//     color: "#333",
//     textAlign: "center",
//     marginBottom: 20,
//   },
//   billDetailsContainer: {
//     width: "100%",
//     backgroundColor: "#F5F5F5",
//     borderRadius: 10,
//     padding: 15,
//     marginBottom: 15,
//   },
//   billRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     marginBottom: 10,
//   },
//   billLabel: {
//     fontSize: 14,
//     color: "#666666",
//     fontWeight: "600",
//   },
//   billValue: {
//     fontSize: 14,
//     fontWeight: "bold",
//     color: "#333333",
//   },
//   billDivider: {
//     height: 1,
//     backgroundColor: "#DDDDDD",
//     marginVertical: 10,
//   },
//   billTotalLabel: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: "#333333",
//   },
//   billTotalValue: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: "#4CAF50",
//   },
//   modalConfirmButton: {
//     backgroundColor: "#4CAF50",
//     paddingVertical: 12,
//     borderRadius: 10,
//     alignItems: "center",
//   },
//   modalConfirmButtonText: {
//     fontSize: 16,
//     fontWeight: "600",
//     color: "#FFFFFF",
//   },
//   sessionSummaryContainer: {
//     width: "100%",
//     backgroundColor: "#F5F5F5",
//     borderRadius: 10,
//     padding: 15,
//     marginBottom: 15,
//   },
//   sessionRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     marginBottom: 10,
//   },
//   sessionLabel: {
//     fontSize: 14,
//     color: "#666666",
//     fontWeight: "600",
//   },
//   sessionValue: {
//     fontSize: 14,
//     fontWeight: "bold",
//     color: "#333333",
//   },
//   sessionDivider: {
//     height: 1,
//     backgroundColor: "#DDDDDD",
//     marginVertical: 10,
//   },
//   sessionTotalLabel: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: "#333333",
//   },
//   sessionTotalValue: {
//     fontSize: 16,
//     fontWeight: "bold",
//     color: "#4CAF50",
//   },
// });

// export default DriverScreen;

