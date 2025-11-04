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
      const response = await fetch(`${API_BASE}/drivers/update-fcm-token`, {
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
          // 🆕 Emit as per requirement (updated to match friend's code)
          socket.emit('driverLocationUpdate', {
            driverId,
            latitude: location.latitude,
            longitude: location.longitude,
            status: driverStatus === "onRide" ? "onRide" : "Live",
            rideId: driverStatus === "onRide" ? ride?.rideId : null,
          });
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
    if (!location || !fullRouteCoords.length) return;
   
    const nearestPoint = findNearestPointOnRoute(location, fullRouteCoords);
    if (!nearestPoint) return;
   
    // Always update the visible route when driver moves
    const remainingRoute = fullRouteCoords.slice(nearestPoint.index);
  
    if (remainingRoute.length > 0) {
      // Add current location to make the route more accurate
      const updatedRoute = [location, ...remainingRoute];
      setVisibleRouteCoords(updatedRoute);
      setNearestPointIndex(nearestPoint.index);
    }
  }, [location, fullRouteCoords, findNearestPointOnRoute]);
  // Throttled route update
  const throttledUpdateVisibleRoute = useCallback(() => {
    if (routeUpdateThrottle.current) {
      clearTimeout(routeUpdateThrottle.current);
    }
   
    routeUpdateThrottle.current = setTimeout(() => {
      updateVisibleRoute();
    }, 500); // friend's throttle
  }, [updateVisibleRoute]);
  // 🆕 Automatically update route as driver moves
  useEffect(() => {
    if (rideStatus === "started" && fullRouteCoords.length > 0) {
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
      
        // ---- periodic route trimming (every 2 s) ----
        if (navigationInterval.current) clearInterval(navigationInterval.current);
        navigationInterval.current = setInterval(() => {
          throttledUpdateVisibleRoute();
        }, 2000);
      
        console.log("🗺️ Navigation started with route updates from pickup to drop");
      }
    } catch (error) {
      console.error("❌ Error starting navigation:", error);
    }
  }, [ride?.pickup, ride?.drop, fetchRoute, throttledUpdateVisibleRoute]);
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
                  setRide((prev) => prev ? { ...prev, routeCoords: pickupRoute } : null);
                  console.log("✅ Driver to pickup route generated");
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
  // ──────────────────────────────────────────────────────────────────────
  //  LOCATION TRACKING – new unified effect (replaces old one)
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let watchId: number | null = null;

    const requestLocation = async () => {
      try {
        // Android permission (iOS is handled by Info.plist)
        if (Platform.OS === "android" && !location) {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: "Location Permission",
              message: "This app needs access to your location for ride tracking",
              buttonNeutral: "Ask Me Later",
              buttonNegative: "Cancel",
              buttonPositive: "OK",
            }
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            Alert.alert("Permission Required", "Location permission is required to go online");
            return;
          }
        }

        if (!location) return;               // safety – should never happen
        watchId = Geolocation.watchPosition(
          (pos) => {
            if (!isMounted.current || !isDriverOnline) return;

            const loc: LocationType = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            };

            setLocation(loc);
            setCurrentSpeed(pos.coords.speed || 0);
            lastLocationUpdate.current = loc;

            // ---- distance calculation (same as before) ----
            if (lastCoord && (rideStatus === "accepted" || rideStatus === "started")) {
              const dist = haversine(lastCoord, loc);
              const distanceKm = dist / 1000;
              setTravelledKm((prev) => prev + distanceKm);

              if (rideStatus === "started" && lastLocationBeforeOtp.current) {
                distanceSinceOtp.current += distanceKm;
              }
            }
            setLastCoord(loc);

            // ---- map auto-center (only when idle) ----
            if (locationUpdateCount.current % 10 === 0 && mapRef.current && !ride) {
              mapRef.current.animateToRegion(
                {
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                },
                500
              );
            }

            // ---- DB + socket update (unchanged) ----
            saveLocationToDatabase(loc).catch(console.error);
          },
          (err) => {
            console.error("Geolocation error:", err);
          },
          {
            enableHighAccuracy: true,
            distanceFilter: 5,          // tighter filter (friend’s code uses 10)
            interval: 3000,
            fastestInterval: 2000,
          }
        );
      } catch (e) {
        console.error("Location setup error:", e);
      }
    };

    // start only when driver is online (your toggle controls isDriverOnline)
    if (isDriverOnline) requestLocation();

    return () => {
      if (watchId !== null) Geolocation.clearWatch(watchId);
    };
  }, [isDriverOnline, location, rideStatus, lastCoord, saveLocationToDatabase]);
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
        {rideStatus === "accepted" && ride?.routeCoords?.length && (
          <Polyline
            coordinates={ride.routeCoords}
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
//   Image,
// } from "react-native";
// import MapView, { Marker, Polyline } from "react-native-maps";
// import Geolocation from "@react-native-community/geolocation";
// import socket from "./socket";
// import haversine from "haversine-distance";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { API_BASE } from "./apiConfig";
// import api from "../utils/api";
// import MaterialIcons from "react-native-vector-icons/MaterialIcons";
// import FontAwesome from "react-native-vector-icons/FontAwesome";

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

// const DriverScreen = ({ route, navigation }: { route: any; navigation: any }) => {
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
//   const [driverId, setDriverId] = useState<string>(route.params?.driverId || "");
//   const [driverName, setDriverName] = useState<string>(
//     route.params?.driverName || ""
//   );
//   const [error, setError] = useState<string | null>(null);
  
//   // Route handling states
//   const [fullRouteCoords, setFullRouteCoords] = useState<LocationType[]>([]);
//   const [visibleRouteCoords, setVisibleRouteCoords] = useState<LocationType[]>([]);
//   const [nearestPointIndex, setNearestPointIndex] = useState(0);
//   const [mapRegion, setMapRegion] = useState<any>(null);
  
//   // New states for verification and bill
//   const [showVerificationModal, setShowVerificationModal] = useState(false);
//   const [showBillModal, setShowBillModal] = useState(false);
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

//   // Refs for optimization
//   const isMounted = useRef(true);
//   const locationUpdateCount = useRef(0);
//   const mapAnimationInProgress = useRef(false);
//   const navigationInterval = useRef<NodeJS.Timeout | null>(null);
//   const lastLocationUpdate = useRef<LocationType | null>(null);
//   const routeUpdateThrottle = useRef<NodeJS.Timeout | null>(null);
//   const distanceSinceOtp = useRef(0);
//   const lastLocationBeforeOtp = useRef<LocationType | null>(null);

//   // Cleanup on unmount
//   useEffect(() => {
//     return () => {
//       isMounted.current = false;
//       if (navigationInterval.current) {
//         clearInterval(navigationInterval.current);
//       }
//       if (routeUpdateThrottle.current) {
//         clearTimeout(routeUpdateThrottle.current);
//       }
//     };
//   }, []);

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
//           setDriverStatus("online");
         
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
//       } catch (error) {
//         console.error("❌ Error loading driver info:", error);
       
//         // Don't clear storage for 404 errors
//         if (error.response && error.response.status === 404) {
//           console.log("⚠️ 404 error - skipping verification, proceeding with stored credentials");
//           const storedDriverId = await AsyncStorage.getItem("driverId");
//           const storedDriverName = await AsyncStorage.getItem("driverName");
         
//           if (storedDriverId && storedDriverName) {
//             setDriverId(storedDriverId);
//             setDriverName(storedDriverName);
//             setDriverStatus("online");
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
//       socket.emit("getUserDataForDriver", { rideId: ride.rideId });
//       const intervalId = setInterval(() => {
//         if (rideStatus === "accepted" || rideStatus === "started") {
//           socket.emit("getUserDataForDriver", { rideId: ride.rideId });
//         }
//       }, 10000);
//       return () => clearInterval(intervalId);
//     }
//   }, [rideStatus, ride?.rideId]);

//   // Optimized location saving
//   const saveLocationToDatabase = useCallback(
//     async (location: LocationType) => {
//       try {
//         locationUpdateCount.current++;
//         if (locationUpdateCount.current % 5 !== 0) {
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

//         if (socket.connected) {
//           socket.emit("driverLocationUpdate", {
//             driverId,
//             latitude: location.latitude,
//             longitude: location.longitude,
//             status: driverStatus === "onRide" ? "onRide" : "Live",
//             rideId: driverStatus === "onRide" ? ride?.rideId : null,
//           });
//         }
//       } catch (error) {
//         console.error("❌ Error saving location to DB:", error);
//       }
//     },
//     [driverId, driverName, driverStatus, ride?.rideId]
//   );

//   // Register driver with socket
//   useEffect(() => {
//     if (!isRegistered && driverId && location) {
//       console.log("📝 Registering driver with socket:", driverId);
//       socket.emit("registerDriver", {
//         driverId,
//         driverName,
//         latitude: location.latitude,
//         longitude: location.longitude,
//         vehicleType: "taxi",
//       });
//       setIsRegistered(true);
//       setDriverStatus("online");
//     }
//   }, [driverId, location, isRegistered, driverName]);

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
//       await api.post("/drivers/logout");
//       await AsyncStorage.clear();
//       console.log("✅ AsyncStorage cleared");
//       socket.disconnect();
//       navigation.replace("LoginScreen");
//       console.log("🧭 Navigated to LoginScreen");
//     } catch (err) {
//       console.error("❌ Error during logout:", err);
//       Alert.alert("❌ Logout Error", "Failed to logout. Please try again.");
//     }
//   };

//   // Accept ride
//   const acceptRide = async (rideId?: string) => {
//     const currentRideId = rideId || ride?.rideId;
//     if (!currentRideId) {
//       Alert.alert("Error", "No ride ID available. Please try again.");
//       return;
//     }
    
//     if (!driverId) {
//       Alert.alert("Error", "Driver not properly registered.");
//       return;
//     }
    
//     if (!socket.connected) {
//       Alert.alert("Connection Error", "Reconnecting to server...");
//       socket.connect();
//       socket.once("connect", () => {
//         setTimeout(() => acceptRide(currentRideId), 1000);
//       });
//       return;
//     }
    
//     setIsLoading(true);
//     setRideStatus("accepted");
//     setDriverStatus("onRide");
    
//     socket.emit(
//       "acceptRide",
//       {
//         rideId: currentRideId,
//         driverId: driverId,
//         driverName: driverName,
//       },
//       async (response: any) => {
//         setIsLoading(false);
//         if (!isMounted.current) return;
        
//         if (response && response.success) {
//           const userDataWithId = {
//             name: response.userName || "User",
//             mobile: response.userMobile || "N/A",
//             location: {
//               latitude: response.pickup.lat,
//               longitude: response.pickup.lng,
//             },
//             userId: response.userId,
//           };
          
//           setUserData(userDataWithId);
//           const initialUserLocation = {
//             latitude: response.pickup.lat,
//             longitude: response.pickup.lng,
//           };
          
//           setUserLocation(initialUserLocation);
          
//           if (location) {
//             // Generate route from driver to pickup location (GREEN ROUTE)
//             try {
//               const pickupRoute = await fetchRoute(location, initialUserLocation);
//               if (pickupRoute) {
//                 setRide((prev) => prev ? { ...prev, routeCoords: pickupRoute } : null);
//                 console.log("✅ Driver to pickup route generated");
//               }
//             } catch (error) {
//               console.error("❌ Error generating pickup route:", error);
//             }
           
//             animateToLocation(initialUserLocation, true);
//           }

//           socket.emit("driverAcceptedRide", {
//             rideId: currentRideId,
//             driverId: driverId,
//             userId: response.userId,
//             driverLocation: location,
//           });
          
//           setTimeout(() => {
//             socket.emit("getUserDataForDriver", { rideId: currentRideId });
//           }, 1000);
//         }
//       }
//     );
//   };

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
    
//     socket.emit("rejectRide", {
//       rideId: currentRideId,
//       driverId,
//     });
    
//     Alert.alert("Ride Rejected ❌", "You rejected the ride");
//   };

  

// const confirmOTP = async () => {
//   if (!ride) return;
  
//   if (!ride.otp) {
//     Alert.alert("Error", "OTP not yet received. Please wait...");
//     return;
//   }
  
//   if (enteredOtp === ride.otp) {
//     // ✅ FIX: Reset distance tracking and start fresh from OTP verification
//     setTravelledKm(0); // Reset the main distance counter
//     distanceSinceOtp.current = 0; // Reset OTP distance counter
//     lastLocationBeforeOtp.current = location; // Set starting point for OTP distance
    
//     setOtpSharedTime(new Date());
//     setRideStatus("started");
//     setOtpModalVisible(false);
//     setEnteredOtp("");
    
//     console.log("✅ OTP Verified - Starting navigation and distance tracking from pickup location");
    
//     if (ride.pickup && ride.drop) {
//       // Start navigation after OTP verification (from pickup to drop)
//       await startNavigation();
//       animateToLocation(ride.drop, true);
//     }

//     // ✅ CRITICAL: Notify user that OTP is verified and ride has started
//     socket.emit("otpVerified", {
//       rideId: ride.rideId,
//       driverId: driverId,
//       userId: userData?.userId,
//       timestamp: new Date().toISOString(),
//       driverLocation: location
//     });

//     socket.emit("driverStartedRide", {
//       rideId: ride.rideId,
//       driverId: driverId,
//       userId: userData?.userId,
//       driverLocation: location,
//       otpVerified: true,
//       timestamp: new Date().toISOString()
//     });

//     socket.emit("rideStatusUpdate", {
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
//     Alert.alert("Invalid OTP", "Please check the OTP and try again.");
//   }
// };

// // In Screen1.tsx - Replace the completeRide function with this:
// const completeRide = async () => {
//   if (!ride) return;
  
//   stopNavigation();
  
//   try {
//     // Calculate final distance - use the distance since OTP verification
//     const finalDistance = distanceSinceOtp.current;
    
//     // ✅ FIX: Use the admin-set fare from the ride object, NOT recalculating
//     let finalFare = ride.fare || 0;
    
//     console.log(`💰 Using admin-set fare: ₹${finalFare} for ${finalDistance.toFixed(2)}km`);
    
//     // Set bill details
//     setBillDetails({
//       distance: `${finalDistance.toFixed(2)} km`,
//       travelTime: `${Math.round(finalDistance * 10)} mins`, // Approximate time
//       charge: Math.round(finalFare),
//       userName: userData?.name || 'Customer',
//       userMobile: userData?.mobile || 'N/A'
//     });
    
//     // Show bill modal
//     setShowBillModal(true);
    
//     // Emit ride completion to server
//     socket.emit("driverCompletedRide", {
//       rideId: ride.rideId,
//       driverId: driverId,
//       userId: userData?.userId,
//       distance: finalDistance,
//       fare: finalFare
//     });
    
//     socket.emit("completeRide", {
//       rideId: ride.rideId,
//       driverId,
//       distance: finalDistance,
//       fare: finalFare // ✅ Use the admin-set fare
//     });
    
//   } catch (error) {
//     console.error("❌ Error completing ride:", error);
//     Alert.alert("Error", "Failed to complete ride. Please try again.");
//   }
// };
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


//   useEffect(() => {
//   let watchId: number | null = null;
  
//   const requestLocation = async () => {
//     try {
//       if (Platform.OS === "android" && !location) {
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
//           Alert.alert(
//             "Permission Denied",
//             "Location permission is required for this app to work"
//           );
//           return;
//         }
//       }

//       if (!location) return;
      
//       watchId = Geolocation.watchPosition(
//         (pos) => {
//           if (!isMounted.current) return;
          
//           const loc: LocationType = {
//             latitude: pos.coords.latitude,
//             longitude: pos.coords.longitude,
//           };
          
//           setLocation(loc);
//           setCurrentSpeed(pos.coords.speed || 0);
//           lastLocationUpdate.current = loc;

//           // ✅ FIX: Only calculate distance after OTP verification (ride started)
//           if (lastCoord) {
//             const dist = haversine(lastCoord, loc);
//             const distanceKm = dist / 1000;
            
//             // Always update main travelledKm for UI display
//             setTravelledKm((prev) => prev + distanceKm);
            
//             // ✅ CRITICAL: Only add to OTP distance when ride has started (after OTP verification)
//             if (rideStatus === "started" && lastLocationBeforeOtp.current) {
//               distanceSinceOtp.current += distanceKm;
//               console.log(`📏 OTP Distance updated: ${distanceSinceOtp.current.toFixed(3)}km (+${distanceKm.toFixed(3)}km)`);
//             }
//           }

//           setLastCoord(loc);
          
//           if (locationUpdateCount.current % 10 === 0 && mapRef.current && !ride) {
//             mapRef.current.animateToRegion(
//               {
//                 latitude: loc.latitude,
//                 longitude: loc.longitude,
//                 latitudeDelta: 0.01,
//                 longitudeDelta: 0.01,
//               },
//               500
//             );
//           }

//           saveLocationToDatabase(loc).catch(console.error);
//         },
//         (err) => {
//           console.error("❌ Geolocation error:", err);
//           Alert.alert(
//             "Location Error",
//             "Could not get your location. Please check your GPS settings and location permissions."
//           );
//         },
//         {
//           enableHighAccuracy: true,
//           distanceFilter: 10,
//           interval: 5000,
//           fastestInterval: 3000,
//           timeout: 15000,
//         }
//       );
//     } catch (error) {
//       console.error("❌ Error setting up location tracking:", error);
//       Alert.alert("Setup Error", "Failed to initialize location tracking");
//     }
//   };
  
//   requestLocation();
  
//   return () => {
//     if (watchId !== null) {
//       Geolocation.clearWatch(watchId);
//     }
//   };
// }, [location, saveLocationToDatabase, rideStatus]);

//   // Socket event listeners
//   useEffect(() => {
//     const handleConnect = () => {
//       if (!isMounted.current) return;
//       setSocketConnected(true);
      
//       if (location && driverId) {
//         socket.emit("registerDriver", {
//           driverId,
//           driverName,
//           latitude: location.latitude,
//           longitude: location.longitude,
//           vehicleType: "taxi",
//         });
//         setIsRegistered(true);
//         setDriverStatus("online");
//       }
//     };

//     const handleRideRequest = (data: any) => {
//       if (!isMounted.current || !data?.rideId) return;
      
//       try {
//         const rideData: RideType = {
//           rideId: data.rideId,
//           RAID_ID: data.RAID_ID || "N/A",
//           otp: data.otp || "0000",
//           pickup: {
//             latitude: data.pickup?.lat || data.pickup?.latitude || 0,
//             longitude: data.pickup?.lng || data.pickup?.longitude || 0,
//             address: data.pickup?.address || "Unknown location",
//           },
//           drop: {
//             latitude: data.drop?.lat || data.drop?.latitude || 0,
//             longitude: data.drop?.lng || data.drop?.longitude || 0,
//             address: data.drop?.address || "Unknown location",
//           },
//           fare: data.fare || 0,
//           distance: data.distance || "0 km",
//           userName: data.userName || "Customer",
//           userMobile: data.userMobile || "N/A",
//         };
        
//         setRide(rideData);
//         setRideStatus("onTheWay");
        
//         Alert.alert(
//           "🚖 New Ride Request!",
//           `📍 Pickup: ${rideData.pickup.address}\n🎯 Drop: ${rideData.drop.address}\n💰 Fare: ₹${rideData.fare}\n📏 Distance: ${rideData.distance}\n👤 Customer: ${rideData.userName}`,
//           [
//             {
//               text: "❌ Reject",
//               onPress: () => rejectRide(rideData.rideId),
//               style: "destructive",
//             },
//             {
//               text: "✅ Accept",
//               onPress: () => acceptRide(rideData.rideId),
//             },
//           ],
//           { cancelable: false }
//         );
//       } catch (error) {
//         console.error("❌ Error processing ride request:", error);
//         Alert.alert("Error", "Could not process ride request. Please try again.");
//       }
//     };

//     const handleUserLiveLocationUpdate = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (data && typeof data.lat === "number" && typeof data.lng === "number") {
//         const newUserLocation = {
//           latitude: data.lat,
//           longitude: data.lng,
//         };
        
//         setUserLocation((prev) => {
//           if (
//             !prev ||
//             prev.latitude !== newUserLocation.latitude ||
//             prev.longitude !== newUserLocation.longitude
//           ) {
//             return newUserLocation;
//           }
//           return prev;
//         });
        
//         setUserData((prev) => {
//           if (prev) {
//             return { ...prev, location: newUserLocation };
//           }
//           return prev;
//         });
//       }
//     };

//     const handleUserDataForDriver = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (data && data.userCurrentLocation) {
//         const userLiveLocation = {
//           latitude: data.userCurrentLocation.latitude,
//           longitude: data.userCurrentLocation.longitude,
//         };
        
//         setUserLocation(userLiveLocation);
        
//         if (userData && !userData.userId && data.userId) {
//           setUserData((prev) => (prev ? { ...prev, userId: data.userId } : null));
//         }
//       }
//     };

//     const handleRideOTP = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         setRide((prev) => (prev ? { ...prev, otp: data.otp } : null));
//       }
//     };

//     const handleDisconnect = () => {
//       if (!isMounted.current) return;
//       setSocketConnected(false);
//       setIsRegistered(false);
//       setDriverStatus("offline");
      
//       if (ride) {
//         setUserData(null);
//         setUserLocation(null);
//         Alert.alert("Connection Lost", "Reconnecting to server...");
//       }
//     };

//     const handleConnectError = (error: Error) => {
//       if (!isMounted.current) return;
//       setSocketConnected(false);
//       setError("Failed to connect to server");
//     };

//     const handleRideCancelled = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         stopNavigation();
        
//         socket.emit("driverRideCancelled", {
//           rideId: ride.rideId,
//           driverId: driverId,
//           userId: userData?.userId,
//         });
        
//         setRide(null);
//         setUserData(null);
//         setUserLocation(null);
//         setTravelledKm(0);
//         setLastCoord(null);
//         setRideStatus("idle");
//         setDriverStatus("online");
//         setFullRouteCoords([]);
//         setVisibleRouteCoords([]);
//         setNearestPointIndex(0);
        
//         Alert.alert("Ride Cancelled", "The passenger cancelled the ride.");
//       }
//     };

//     const handleRideAlreadyAccepted = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         setRide(null);
//         setUserData(null);
//         setUserLocation(null);
//         setTravelledKm(0);
//         setLastCoord(null);
//         setRideStatus("idle");
//         setDriverStatus("online");
        
//         Alert.alert(
//           "Ride Taken",
//           data.message || "This ride has already been accepted by another driver."
//         );
//       }
//     };

//     // Handle ride started event (when OTP is verified)
//     const handleRideStarted = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         console.log("🎉 Ride started - showing verification modal");
        
//         // Set verification details
//         setVerificationDetails({
//           pickup: ride.pickup.address || "Pickup location",
//           dropoff: ride.drop.address || "Dropoff location",
//           time: new Date().toLocaleTimeString(),
//           speed: currentSpeed,
//           distance: distanceSinceOtp.current,
//         });
        
//         // Show verification modal
//         setShowVerificationModal(true);
//       }
//     };

//     socket.on("connect", handleConnect);
//     socket.on("newRideRequest", handleRideRequest);
//     socket.on("userLiveLocationUpdate", handleUserLiveLocationUpdate);
//     socket.on("userDataForDriver", handleUserDataForDriver);
//     socket.on("rideOTP", handleRideOTP);
//     socket.on("disconnect", handleDisconnect);
//     socket.on("connect_error", handleConnectError);
//     socket.on("rideCancelled", handleRideCancelled);
//     socket.on("rideAlreadyAccepted", handleRideAlreadyAccepted);
//     socket.on("rideStarted", handleRideStarted);
    
//     if (!socket.connected) {
//       socket.connect();
//     }
    
//     return () => {
//       socket.off("connect", handleConnect);
//       socket.off("newRideRequest", handleRideRequest);
//       socket.off("userLiveLocationUpdate", handleUserLiveLocationUpdate);
//       socket.off("userDataForDriver", handleUserDataForDriver);
//       socket.off("rideOTP", handleRideOTP);
//       socket.off("disconnect", handleDisconnect);
//       socket.off("connect_error", handleConnectError);
//       socket.off("rideCancelled", handleRideCancelled);
//       socket.off("rideAlreadyAccepted", handleRideAlreadyAccepted);
//       socket.off("rideStarted", handleRideStarted);
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

//   if (!location) {
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
//           latitude: location.latitude,
//           longitude: location.longitude,
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
//   <TouchableOpacity
//     style={[styles.button, styles.completeButton]}
//     onPress={completeRide}
//   >
//     <Text style={styles.btnText}>
//       Complete Ride ({distanceSinceOtp.current.toFixed(2)} km)
//     </Text>
//   </TouchableOpacity>
// )}

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
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// };

// export default DriverScreen;

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
//   statusContainer: {
//     position: "absolute",
//     top: Platform.OS === "ios" ? 50 : 40,
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
// });


















































































































































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
//   Linking,
// } from "react-native";
// import MapView, { Marker, Polyline } from "react-native-maps";
// import Geolocation from "@react-native-community/geolocation";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { API_BASE } from "./apiConfig";
// import api from "../utils/api";
// import MaterialIcons from "react-native-vector-icons/MaterialIcons";
// import FontAwesome from "react-native-vector-icons/FontAwesome";
// import BackgroundTimer from 'react-native-background-timer';

// // Import the NotificationService
// import NotificationService from './Notifications'; 

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

// const DriverScreen = ({ route, navigation }: { route: any; navigation: any }) => {
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
//   const [driverId, setDriverId] = useState<string>(route.params?.driverId || "");
//   const [driverName, setDriverName] = useState<string>(
//     route.params?.driverName || ""
//   );
//   const [error, setError] = useState<string | null>(null);
  
//   // Route handling states
//   const [fullRouteCoords, setFullRouteCoords] = useState<LocationType[]>([]);
//   const [visibleRouteCoords, setVisibleRouteCoords] = useState<LocationType[]>([]);
//   const [nearestPointIndex, setNearestPointIndex] = useState(0);
//   const [mapRegion, setMapRegion] = useState<any>(null);
  
//   // New states for verification and bill
//   const [showVerificationModal, setShowVerificationModal] = useState(false);
//   const [showBillModal, setShowBillModal] = useState(false);
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

//   // 🆕 NEW: Online/Offline toggle state
//   const [isDriverOnline, setIsDriverOnline] = useState(false);
//   const [backgroundTrackingActive, setBackgroundTrackingActive] = useState(false);
  
//   // 🆕 FCM Notification states
//   const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
//   const [isBackgroundMode, setIsBackgroundMode] = useState(false);

//   // Refs for optimization
//   const isMounted = useRef(true);
//   const locationUpdateCount = useRef(0);
//   const mapAnimationInProgress = useRef(false);
//   const navigationInterval = useRef<NodeJS.Timeout | null>(null);
//   const lastLocationUpdate = useRef<LocationType | null>(null);
//   const routeUpdateThrottle = useRef<NodeJS.Timeout | null>(null);
//   const distanceSinceOtp = useRef(0);
//   const lastLocationBeforeOtp = useRef<LocationType | null>(null);
//   const appState = useRef(AppState.currentState);
//   const geolocationWatchId = useRef<number | null>(null);
//   const backgroundLocationInterval = useRef<NodeJS.Timeout | null>(null);

//   // Socket import
//   let socket: any = null;
//   try {
//     socket = require("./socket").default;
//   } catch (error) {
//     console.warn("⚠️ Socket not available:", error);
//   }

//   // Haversine distance function
//   const haversine = (start: LocationType, end: LocationType) => {
//     const R = 6371; // Earth's radius in kilometers
//     const dLat = (end.latitude - start.latitude) * Math.PI / 180;
//     const dLon = (end.longitude - start.longitude) * Math.PI / 180;
//     const a = 
//       Math.sin(dLat/2) * Math.sin(dLat/2) +
//       Math.cos(start.latitude * Math.PI / 180) * Math.cos(end.latitude * Math.PI / 180) * 
//       Math.sin(dLon/2) * Math.sin(dLon/2);
//     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
//     return R * c * 1000; // Distance in meters
//   };

//   // Cleanup on unmount
//   useEffect(() => {
//     return () => {
//       isMounted.current = false;
//       if (navigationInterval.current) {
//         clearInterval(navigationInterval.current);
//       }
//       if (routeUpdateThrottle.current) {
//         clearTimeout(routeUpdateThrottle.current);
//       }
//       if (geolocationWatchId.current) {
//         Geolocation.clearWatch(geolocationWatchId.current);
//       }
//       if (backgroundLocationInterval.current) {
//         clearInterval(backgroundLocationInterval.current);
//       }
//       // Clean up notification listeners
//       NotificationService.off('rideRequest', handleNotificationRideRequest);
//       NotificationService.off('tokenRefresh', () => {});
//     };
//   }, []);

//   // 🆕 NEW: Socket connect/disconnect based on online status
//   useEffect(() => {
//     if (socket) {
//       if (isDriverOnline) {
//         console.log("🔌 Connecting socket for online driver");
//         socket.connect();
//       } else {
//         console.log("🔌 Disconnecting socket for offline driver");
//         socket.disconnect();
//       }
//     }
//   }, [isDriverOnline]);

//   // 🆕 Background location tracking with regular geolocation
//   const startBackgroundLocationTracking = useCallback(() => {
//     console.log("🔄 Starting background location tracking");
    
//     // Stop any existing tracking
//     if (geolocationWatchId.current) {
//       Geolocation.clearWatch(geolocationWatchId.current);
//     }
    
//     // Start high-frequency tracking when online
//     geolocationWatchId.current = Geolocation.watchPosition(
//       (position) => {
//         if (!isMounted.current || !isDriverOnline) return;
        
//         const newLocation = {
//           latitude: position.coords.latitude,
//           longitude: position.coords.longitude,
//         };
        
//         console.log("📍 Location update:", newLocation);
//         setLocation(newLocation);
//         setCurrentSpeed(position.coords.speed || 0);
        
//         // Update distance if ride is active
//         if (lastCoord && (rideStatus === "accepted" || rideStatus === "started")) {
//           const dist = haversine(lastCoord, newLocation);
//           const distanceKm = dist / 1000;
//           setTravelledKm((prev) => prev + distanceKm);
          
//           if (rideStatus === "started" && lastLocationBeforeOtp.current) {
//             distanceSinceOtp.current += distanceKm;
//           }
//         }
        
//         setLastCoord(newLocation);
//         lastLocationUpdate.current = newLocation;
        
//         // Send to server and socket
//         saveLocationToDatabase(newLocation);
//       },
//       (error) => {
//         console.error("❌ Geolocation error:", error);
//       },
//       {
//         enableHighAccuracy: true,
//         distanceFilter: 5, // 5 meters
//         interval: 3000, // 3 seconds
//         fastestInterval: 2000, // 2 seconds
//       }
//     );
    
//     setBackgroundTrackingActive(true);
//   }, [isDriverOnline, lastCoord, rideStatus]);

//   // 🆕 Stop background location tracking
//   const stopBackgroundLocationTracking = useCallback(() => {
//     console.log("🛑 Stopping background location tracking");
    
//     if (geolocationWatchId.current) {
//       Geolocation.clearWatch(geolocationWatchId.current);
//       geolocationWatchId.current = null;
//     }
    
//     if (backgroundLocationInterval.current) {
//       clearInterval(backgroundLocationInterval.current);
//       backgroundLocationInterval.current = null;
//     }
    
//     setBackgroundTrackingActive(false);
//   }, []);

//   // 🆕 Handle app state changes for background tracking
//   useEffect(() => {
//     const handleAppStateChange = (nextAppState: string) => {
//       if (nextAppState === 'background' && isDriverOnline) {
//         console.log("📱 App in background, maintaining location tracking");
//         setIsBackgroundMode(true);
//       } else if (nextAppState === 'active' && isDriverOnline) {
//         console.log("📱 App in foreground");
//         setIsBackgroundMode(false);
//         // Check for pending notifications when app comes to foreground
//         NotificationService.checkPendingNotifications();
//       }
//     };

//     const subscription = AppState.addEventListener('change', handleAppStateChange);

//     return () => {
//       subscription.remove();
//     };
//   }, [isDriverOnline]);

//   // 🆕 FCM: Initialize notification system
//   useEffect(() => {
//     const initializeNotificationSystem = async () => {
//       try {
//         console.log('🔔 Setting up complete notification system...');
        
//         // Initialize the notification service
//         const initialized = await NotificationService.initializeNotifications();
        
//         if (initialized) {
//           console.log('✅ Notification system initialized successfully');
          
//           // Get FCM token and send to server
//           const token = await NotificationService.getFCMToken();
//           if (token && driverId) {
//             await sendFCMTokenToServer(token);
//           }
          
//           // Listen for ride requests
//           NotificationService.on('rideRequest', handleNotificationRideRequest);
          
//           // Listen for token refresh
//           NotificationService.on('tokenRefresh', async (newToken) => {
//             console.log('🔄 FCM token refreshed, updating server...');
//             if (driverId) {
//               await sendFCMTokenToServer(newToken);
//             }
//           });
          
//           setHasNotificationPermission(true);
//         } else {
//           console.log('❌ Notification system initialization failed');
//           setHasNotificationPermission(false);
//         }
//       } catch (error) {
//         console.error('❌ Error in notification system initialization:', error);
//         // Don't block the app if notifications fail
//         setHasNotificationPermission(false);
//       }
//     };

//     // Initialize when driver goes online
//     if ((driverStatus === 'online' || driverStatus === 'onRide') && !hasNotificationPermission) {
//       initializeNotificationSystem();
//     }

//     return () => {
//       // Cleanup
//       NotificationService.off('rideRequest', handleNotificationRideRequest);
//     };
//   }, [driverStatus, driverId, hasNotificationPermission]);

//   // 🆕 FCM: Send token to server
//   const sendFCMTokenToServer = async (token: string): Promise<boolean> => {
//     try {
//       const authToken = await AsyncStorage.getItem("authToken");
//       if (!authToken) {
//         console.log('❌ No auth token available');
//         return false;
//       }

//       console.log('📤 Sending FCM token to server...');
      
//       // Use the correct endpoint - adjust as per your backend
//       const response = await fetch(`${API_BASE}/drivers/update-fcm-token`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           Authorization: `Bearer ${authToken}`,
//         },
//         body: JSON.stringify({
//           driverId: driverId,
//           fcmToken: token,
//           platform: Platform.OS
//         }),
//       });
      
//       console.log('📡 Response status:', response.status);
      
//       if (response.ok) {
//         const result = await response.json();
//         console.log('✅ FCM token updated on server:', result);
//         return true;
//       } else {
//         const errorText = await response.text();
//         console.log('❌ Server error:', response.status, errorText);
//         return false;
//       }
//     } catch (error) {
//       console.error('❌ Network error sending token:', error);
//       return false;
//     }
//   };

//   // 🆕 FCM: Handle notification ride request
//   const handleNotificationRideRequest = (data: any) => {
//     console.log('📱 Received ride request via notification:', data);
    
//     if (!data || data.type !== 'ride_request') {
//       console.error('Invalid ride request payload:', data);
//       return;
//     }
    
//     const rideData: RideType = {
//       rideId: data.rideId,
//       RAID_ID: data.RAID_ID || "N/A",
//       otp: data.otp || "0000",
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
//       userName: data.userName || data.customerName || "Customer",
//       userMobile: data.userMobile || "N/A",
//     };
    
//     console.log('📱 Processed ride data:', rideData);
//     handleRideRequest(rideData);
//   };

//   // 🆕 FCM: Test notification function
//   const testNotification = async () => {
//     try {
//       console.log('🧪 Testing notification...');
//       await NotificationService.testNotification();
//       Alert.alert('Test', 'Notification test triggered');
//     } catch (error) {
//       console.error('Test notification failed:', error);
//       Alert.alert('Test Failed', 'Could not show test notification');
//     }
//   };

//   // 🆕 Toggle Online/Offline Status
//   const toggleOnlineStatus = async () => {
//     try {
//       if (!isDriverOnline) {
//         // Going ONLINE
//         console.log("🟢 Driver going ONLINE - Starting location tracking");
        
//         // Request permissions first
//         if (Platform.OS === "android") {
//           const granted = await PermissionsAndroid.request(
//             PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
//             {
//               title: "Location Permission",
//               message: "This app needs access to your location for ride tracking",
//               buttonNeutral: "Ask Me Later",
//               buttonNegative: "Cancel",
//               buttonPositive: "OK"
//             }
//           );
          
//           if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
//             Alert.alert("Permission Required", "Location permission is required to go online");
//             return;
//           }
//         }

//         // Get current location first
//         Geolocation.getCurrentPosition(
//           async (pos) => {
//             const currentLoc = {
//               latitude: pos.coords.latitude,
//               longitude: pos.coords.longitude,
//             };
            
//             setLocation(currentLoc);
//             setLastCoord(currentLoc);

//             // Initialize FCM before starting tracking
//             console.log('🔔 Initializing FCM...');
//             try {
//               const initialized = await NotificationService.initializeNotifications();
//               if (initialized) {
//                 const token = await NotificationService.getFCMToken();
//                 if (token) {
//                   await sendFCMTokenToServer(token);
//                 }
//                 // Set up listeners
//                 NotificationService.on('rideRequest', handleNotificationRideRequest);
//                 NotificationService.on('tokenRefresh', async (newToken) => {
//                   console.log('🔄 FCM token refreshed, updating server...');
//                   await sendFCMTokenToServer(newToken);
//                 });
//                 setHasNotificationPermission(true);
//                 console.log('✅ FCM initialized');
//               }
//             } catch (error) {
//               console.warn('⚠️ FCM initialization failed:', error);
//             }

//             // Start background tracking
//             startBackgroundLocationTracking();

//             // Set states (this will trigger socket connect via useEffect)
//             setIsDriverOnline(true);
//             setDriverStatus("online");

//             // Save online status
//             await AsyncStorage.setItem("driverOnlineStatus", "online");

//             Alert.alert("✅ Online", "You are now online and ready to accept rides");
//           },
//           (error) => {
//             console.error("❌ Error getting location:", error);
//             Alert.alert("Error", "Failed to get your location. Please check GPS settings.");
//           },
//           { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
//         );

//       } else {
//         // Going OFFLINE
//         console.log("🔴 Driver going OFFLINE - Stopping location tracking");
        
//         if (ride) {
//           Alert.alert(
//             "Active Ride",
//             "You have an active ride. Please complete it before going offline.",
//             [{ text: "OK" }]
//           );
//           return;
//         }

//         // Stop background tracking immediately
//         stopBackgroundLocationTracking();

//         // Notify socket if available (emit before disconnect)
//         if (socket && socket.connected) {
//           socket.emit("driverWentOffline", { driverId });
//         }

//         // Set states (this will trigger socket disconnect via useEffect)
//         setIsDriverOnline(false);
//         setDriverStatus("offline");

//         // Save offline status
//         await AsyncStorage.setItem("driverOnlineStatus", "offline");

//         Alert.alert("🔴 Offline", "You are now offline and won't receive ride requests");
//       }
//     } catch (error) {
//       console.error("❌ Error toggling online status:", error);
//       Alert.alert("Error", "Failed to change status. Please try again.");
//     }
//   };

//   // Load driver info and verify token on mount
//   useEffect(() => {
//     const loadDriverInfo = async () => {
//       try {
//         console.log("🔍 Loading driver info from AsyncStorage...");
//         const storedDriverId = await AsyncStorage.getItem("driverId");
//         const storedDriverName = await AsyncStorage.getItem("driverName");
//         const token = await AsyncStorage.getItem("authToken");
//         const savedOnlineStatus = await AsyncStorage.getItem("driverOnlineStatus");
        
//         if (storedDriverId && storedDriverName && token) {
//           setDriverId(storedDriverId);
//           setDriverName(storedDriverName);
//           console.log("✅ Token found, skipping verification");
          
//           // Restore online status if it was online before
//           if (savedOnlineStatus === "online") {
//             setIsDriverOnline(true);
//             setDriverStatus("online");
//             // Start tracking (socket connect triggered by useEffect on isDriverOnline)
//             startBackgroundLocationTracking();
//           }
         
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
//               setLastCoord({
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
//       } catch (error) {
//         console.error("❌ Error loading driver info:", error);
//         await AsyncStorage.clear();
//         navigation.replace("LoginScreen");
//       }
//     };
    
//     if (!driverId || !driverName) {
//       loadDriverInfo();
//     }
//   }, [driverId, driverName, navigation, location]);

//   // Request user location when ride is accepted
//   useEffect(() => {
//     if (rideStatus === "accepted" && ride?.rideId && socket) {
//       console.log("📍 Requesting initial user location for accepted ride");
//       socket.emit("getUserDataForDriver", { rideId: ride.rideId });
//       const intervalId = setInterval(() => {
//         if (rideStatus === "accepted" || rideStatus === "started") {
//           socket.emit("getUserDataForDriver", { rideId: ride.rideId });
//         }
//       }, 10000);
//       return () => clearInterval(intervalId);
//     }
//   }, [rideStatus, ride?.rideId]);

//   // Optimized location saving
//   const saveLocationToDatabase = useCallback(
//     async (location: LocationType) => {
//       try {
//         locationUpdateCount.current++;
//         if (locationUpdateCount.current % 3 !== 0) { // Send every 3rd update
//           return;
//         }
        
//         const payload = {
//           driverId,
//           driverName: driverName || "Unknown Driver",
//           latitude: location.latitude,
//           longitude: location.longitude,
//           vehicleType: "taxi",
//           status: driverStatus === "onRide" ? "onRide" : isDriverOnline ? "Live" : "offline",
//           rideId: driverStatus === "onRide" ? ride?.rideId : null,
//           timestamp: new Date().toISOString(),
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

//         if (socket && socket.connected && isDriverOnline) {
//           // 🆕 Emit as per requirement
//           socket.emit('driverLocation', { latitude: location.latitude, longitude: location.longitude });
//         }
//       } catch (error) {
//         console.error("❌ Error saving location to DB:", error);
//       }
//     },
//     [driverId, driverName, driverStatus, ride?.rideId, isDriverOnline]
//   );

//   // Register driver with socket
//   useEffect(() => {
//     if (!isRegistered && driverId && location && isDriverOnline && socket) {
//       console.log("📝 Registering driver with socket:", driverId);
//       socket.emit("registerDriver", {
//         driverId,
//         driverName,
//         latitude: location.latitude,
//         longitude: location.longitude,
//         vehicleType: "taxi",
//       });
//       setIsRegistered(true);
//     }
//   }, [driverId, location, isRegistered, driverName, isDriverOnline]);

//   // 🆕 Route fetching with real-time updates
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
//         // Return a straight line route as fallback
//         return [origin, destination];
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

//   // 🆕 Update visible route as driver moves (Dynamic Polyline)
//   const updateVisibleRoute = useCallback(() => {
//     if (!location || !fullRouteCoords.length) {
//       return;
//     }
    
//     const nearestPoint = findNearestPointOnRoute(location, fullRouteCoords);
//     if (!nearestPoint) return;
    
//     // Update the polyline to show only the remaining route
//     const remainingRoute = fullRouteCoords.slice(nearestPoint.index);
   
//     if (remainingRoute.length > 0) {
//       const updatedRoute = [location, ...remainingRoute];
//       setVisibleRouteCoords(updatedRoute);
//       setNearestPointIndex(nearestPoint.index);
//       console.log(`📍 Route updated: ${remainingRoute.length} points remaining`);
//     }
//   }, [location, fullRouteCoords, findNearestPointOnRoute]);

//   // Throttled route update
//   const throttledUpdateVisibleRoute = useCallback(() => {
//     if (routeUpdateThrottle.current) {
//       clearTimeout(routeUpdateThrottle.current);
//     }
    
//     routeUpdateThrottle.current = setTimeout(() => {
//       updateVisibleRoute();
//     }, 2000); // Update every 2 seconds
//   }, [updateVisibleRoute]);

//   // 🆕 Automatically update route as driver moves
//   useEffect(() => {
//     if ((rideStatus === "accepted" || rideStatus === "started") && fullRouteCoords.length > 0) {
//       throttledUpdateVisibleRoute();
//     }
//   }, [location, rideStatus, fullRouteCoords, throttledUpdateVisibleRoute]);

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
       
//         setFullRouteCoords(routeCoords);
//         setVisibleRouteCoords(routeCoords);
       
//         console.log("🗺️ Navigation started with dynamic route updates");
//       }
//     } catch (error) {
//       console.error("❌ Error starting navigation:", error);
//     }
//   }, [ride?.pickup, ride?.drop, fetchRoute]);

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
      
//       if (ride) {
//         Alert.alert(
//           "Active Ride",
//           "Please complete your current ride before logging out.",
//           [{ text: "OK" }]
//         );
//         return;
//       }

//       // Stop background tracking
//       stopBackgroundLocationTracking();

//       await api.post("/drivers/logout");
//       await AsyncStorage.clear();
//       console.log("✅ AsyncStorage cleared");
//       if (socket) {
//         socket.disconnect();
//       }
//       navigation.replace("LoginScreen");
//       console.log("🧭 Navigated to LoginScreen");
//     } catch (err) {
//       console.error("❌ Error during logout:", err);
//       Alert.alert("❌ Logout Error", "Failed to logout. Please try again.");
//     }
//   };

//   // Accept ride
//   const acceptRide = async (rideId?: string) => {
//     const currentRideId = rideId || ride?.rideId;
//     if (!currentRideId) {
//       Alert.alert("Error", "No ride ID available. Please try again.");
//       return;
//     }
    
//     if (!driverId) {
//       Alert.alert("Error", "Driver not properly registered.");
//       return;
//     }
    
//     if (socket && !socket.connected) {
//       Alert.alert("Connection Error", "Reconnecting to server...");
//       socket.connect();
//       socket.once("connect", () => {
//         setTimeout(() => acceptRide(currentRideId), 1000);
//       });
//       return;
//     }
    
//     setIsLoading(true);
//     setRideStatus("accepted");
//     setDriverStatus("onRide");
    
//     if (socket) {
//       socket.emit(
//         "acceptRide",
//         {
//           rideId: currentRideId,
//           driverId: driverId,
//           driverName: driverName,
//         },
//         async (response: any) => {
//           setIsLoading(false);
//           if (!isMounted.current) return;
          
//           if (response && response.success) {
//             const userDataWithId = {
//               name: response.userName || "User",
//               mobile: response.userMobile || "N/A",
//               location: {
//                 latitude: response.pickup.lat,
//                 longitude: response.pickup.lng,
//               },
//               userId: response.userId,
//             };
            
//             setUserData(userDataWithId);
//             const initialUserLocation = {
//               latitude: response.pickup.lat,
//               longitude: response.pickup.lng,
//             };
            
//             setUserLocation(initialUserLocation);
            
//             if (location) {
//               // 🆕 Generate dynamic route from driver to pickup (GREEN ROUTE)
//               try {
//                 const pickupRoute = await fetchRoute(location, initialUserLocation);
//                 if (pickupRoute) {
//                   setFullRouteCoords(pickupRoute);
//                   setVisibleRouteCoords(pickupRoute);
//                   console.log("✅ Driver to pickup route generated and will update dynamically");
//                 }
//               } catch (error) {
//                 console.error("❌ Error generating pickup route:", error);
//               }
             
//               animateToLocation(initialUserLocation, true);
//             }

//             socket.emit("driverAcceptedRide", {
//               rideId: currentRideId,
//               driverId: driverId,
//               userId: response.userId,
//               driverLocation: location,
//             });
            
//             setTimeout(() => {
//               socket.emit("getUserDataForDriver", { rideId: currentRideId });
//             }, 1000);
//           }
//         }
//       );
//     }
//   };

//   // Reject ride
//   const rejectRide = (rideId?: string) => {
//     const currentRideId = rideId || ride?.rideId;
//     if (!currentRideId) return;
    
//     // 🆕 Clean map data
//     clearMapData();
    
//     setRide(null);
//     setRideStatus("idle");
//     setDriverStatus("online");
//     setUserData(null);
//     setUserLocation(null);
    
//     if (socket) {
//       socket.emit("rejectRide", {
//         rideId: currentRideId,
//         driverId,
//       });
//     }
    
//     Alert.alert("Ride Rejected ❌", "You rejected the ride");
//   };

//   // 🆕 Clear all map data (markers, routes, polylines)
//   const clearMapData = useCallback(() => {
//     console.log("🧹 Clearing all map data");
//     setFullRouteCoords([]);
//     setVisibleRouteCoords([]);
//     setNearestPointIndex(0);
//     setUserLocation(null);
//     setTravelledKm(0);
//     setLastCoord(null);
//     distanceSinceOtp.current = 0;
//     lastLocationBeforeOtp.current = null;
    
//     // Reset map region to driver's current location
//     if (location && mapRef.current) {
//       mapRef.current.animateToRegion({
//         latitude: location.latitude,
//         longitude: location.longitude,
//         latitudeDelta: 0.01,
//         longitudeDelta: 0.01,
//       }, 1000);
//     }
//   }, [location]);

//   const confirmOTP = async () => {
//     if (!ride) return;
    
//     if (!ride.otp) {
//       Alert.alert("Error", "OTP not yet received. Please wait...");
//       return;
//     }
    
//     if (enteredOtp === ride.otp) {
//       setTravelledKm(0);
//       distanceSinceOtp.current = 0;
//       lastLocationBeforeOtp.current = location;
      
//       setOtpSharedTime(new Date());
//       setRideStatus("started");
//       setOtpModalVisible(false);
//       setEnteredOtp("");
      
//       console.log("✅ OTP Verified - Starting navigation from pickup to drop");
      
//       if (ride.pickup && ride.drop) {
//         // 🆕 Start navigation with dynamic route from pickup to drop (RED ROUTE)
//         await startNavigation();
//         animateToLocation(ride.drop, true);
//       }

//       if (socket) {
//         socket.emit("otpVerified", {
//           rideId: ride.rideId,
//           driverId: driverId,
//           userId: userData?.userId,
//           timestamp: new Date().toISOString(),
//           driverLocation: location
//         });

//         socket.emit("driverStartedRide", {
//           rideId: ride.rideId,
//           driverId: driverId,
//           userId: userData?.userId,
//           driverLocation: location,
//           otpVerified: true,
//           timestamp: new Date().toISOString()
//         });

//         socket.emit("rideStatusUpdate", {
//           rideId: ride.rideId,
//           status: "started",
//           otpVerified: true,
//           timestamp: new Date().toISOString()
//         });
//       }
      
//       console.log("📢 Emitted OTP verification events to user");
      
//       Alert.alert(
//         "OTP Verified ✅",
//         "Navigation started. Route will update dynamically as you move.",
//         [{ text: "OK" }]
//       );
//     } else {
//       Alert.alert("Invalid OTP", "Please check the OTP and try again.");
//     }
//   };

//   const completeRide = async () => {
//     if (!ride) return;
    
//     stopNavigation();
    
//     try {
//       const finalDistance = distanceSinceOtp.current;
//       let finalFare = ride.fare || 0;
      
//       console.log(`💰 Using admin-set fare: ₹${finalFare} for ${finalDistance.toFixed(2)}km`);
      
//       setBillDetails({
//         distance: `${finalDistance.toFixed(2)} km`,
//         travelTime: `${Math.round(finalDistance * 10)} mins`,
//         charge: Math.round(finalFare),
//         userName: userData?.name || 'Customer',
//         userMobile: userData?.mobile || 'N/A'
//       });
      
//       setShowBillModal(true);
      
//       if (socket) {
//         socket.emit("driverCompletedRide", {
//           rideId: ride.rideId,
//           driverId: driverId,
//           userId: userData?.userId,
//           distance: finalDistance,
//           fare: finalFare
//         });
        
//         socket.emit("completeRide", {
//           rideId: ride.rideId,
//           driverId,
//           distance: finalDistance,
//           fare: finalFare
//         });
//       }
      
//     } catch (error) {
//       console.error("❌ Error completing ride:", error);
//       Alert.alert("Error", "Failed to complete ride. Please try again.");
//     }
//   };

//   // 🆕 Handle bill modal close with map cleanup
//   const handleBillModalClose = () => {
//     setShowBillModal(false);
//     setRideStatus("completed");
//     setDriverStatus("online");
    
//     // 🆕 Clean all map data after ride completion
//     clearMapData();
    
//     // Reset all ride states
//     setRide(null);
//     setUserData(null);
//     setOtpSharedTime(null);
    
//     console.log("✅ Ride completed and map cleaned");
//   };

//   // Handle verification modal close
//   const handleVerificationModalClose = () => {
//     setShowVerificationModal(false);
//   };

//   // Handle ride requests
//   const handleRideRequest = (data: any) => {
//     if (!isMounted.current || !data?.rideId || !isDriverOnline) return;
    
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
//             onPress: () => rejectRide(rideData.rideId),
//             style: "destructive",
//           },
//           {
//             text: "✅ Accept",
//             onPress: () => acceptRide(rideData.rideId),
//           },
//         ],
//         { cancelable: false }
//       );
//     } catch (error) {
//       console.error("❌ Error processing ride request:", error);
//       Alert.alert("Error", "Could not process ride request. Please try again.");
//     }
//   };

//   // Socket event listeners
//   useEffect(() => {
//     if (!socket) {
//       console.warn("⚠️ Socket not available, skipping socket event listeners");
//       return;
//     }

//     const handleConnect = () => {
//       if (!isMounted.current) return;
//       setSocketConnected(true);
      
//       if (location && driverId && isDriverOnline) {
//         socket.emit("registerDriver", {
//           driverId,
//           driverName,
//           latitude: location.latitude,
//           longitude: location.longitude,
//           vehicleType: "taxi",
//         });
//         setIsRegistered(true);
//       }
//     };

//     const handleRideRequest = (data: any) => {
//       if (!isMounted.current || !data?.rideId || !isDriverOnline) return;
      
//       try {
//         const rideData: RideType = {
//           rideId: data.rideId,
//           RAID_ID: data.RAID_ID || "N/A",
//           otp: data.otp || "0000",
//           pickup: {
//             latitude: data.pickup?.lat || data.pickup?.latitude || 0,
//             longitude: data.pickup?.lng || data.pickup?.longitude || 0,
//             address: data.pickup?.address || "Unknown location",
//           },
//           drop: {
//             latitude: data.drop?.lat || data.drop?.latitude || 0,
//             longitude: data.drop?.lng || data.drop?.longitude || 0,
//             address: data.drop?.address || "Unknown location",
//           },
//           fare: data.fare || 0,
//           distance: data.distance || "0 km",
//           userName: data.userName || "Customer",
//           userMobile: data.userMobile || "N/A",
//         };
        
//         setRide(rideData);
//         setRideStatus("onTheWay");
        
//         Alert.alert(
//           "🚖 New Ride Request!",
//           `📍 Pickup: ${rideData.pickup.address}\n🎯 Drop: ${rideData.drop.address}\n💰 Fare: ₹${rideData.fare}\n📏 Distance: ${rideData.distance}\n👤 Customer: ${rideData.userName}`,
//           [
//             {
//               text: "❌ Reject",
//               onPress: () => rejectRide(rideData.rideId),
//               style: "destructive",
//             },
//             {
//               text: "✅ Accept",
//               onPress: () => acceptRide(rideData.rideId),
//             },
//           ],
//           { cancelable: false }
//         );
//       } catch (error) {
//         console.error("❌ Error processing ride request:", error);
//         Alert.alert("Error", "Could not process ride request. Please try again.");
//       }
//     };

//     const handleUserLiveLocationUpdate = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (data && typeof data.lat === "number" && typeof data.lng === "number") {
//         const newUserLocation = {
//           latitude: data.lat,
//           longitude: data.lng,
//         };
        
//         setUserLocation((prev) => {
//           if (
//             !prev ||
//             prev.latitude !== newUserLocation.latitude ||
//             prev.longitude !== newUserLocation.longitude
//           ) {
//             return newUserLocation;
//           }
//           return prev;
//         });
        
//         setUserData((prev) => {
//           if (prev) {
//             return { ...prev, location: newUserLocation };
//           }
//           return prev;
//         });
//       }
//     };

//     const handleUserDataForDriver = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (data && data.userCurrentLocation) {
//         const userLiveLocation = {
//           latitude: data.userCurrentLocation.latitude,
//           longitude: data.userCurrentLocation.longitude,
//         };
        
//         setUserLocation(userLiveLocation);
        
//         if (userData && !userData.userId && data.userId) {
//           setUserData((prev) => (prev ? { ...prev, userId: data.userId } : null));
//         }
//       }
//     };

//     const handleRideOTP = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         setRide((prev) => (prev ? { ...prev, otp: data.otp } : null));
//       }
//     };

//     const handleDisconnect = () => {
//       if (!isMounted.current) return;
//       setSocketConnected(false);
//       setIsRegistered(false);
      
//       if (ride) {
//         setUserData(null);
//         setUserLocation(null);
//         Alert.alert("Connection Lost", "Reconnecting to server...");
//       }
//     };

//     const handleConnectError = (error: Error) => {
//       if (!isMounted.current) return;
//       setSocketConnected(false);
//       setError("Failed to connect to server");
//     };

//     const handleRideCancelled = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         stopNavigation();
        
//         socket.emit("driverRideCancelled", {
//           rideId: ride.rideId,
//           driverId: driverId,
//           userId: userData?.userId,
//         });
        
//         // 🆕 Clean map after cancellation
//         clearMapData();
        
//         setRide(null);
//         setUserData(null);
//         setRideStatus("idle");
//         setDriverStatus("online");
        
//         Alert.alert("Ride Cancelled", "The passenger cancelled the ride.");
//       }
//     };

//     const handleRideAlreadyAccepted = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         // 🆕 Clean map
//         clearMapData();
        
//         setRide(null);
//         setUserData(null);
//         setRideStatus("idle");
//         setDriverStatus("online");
        
//         Alert.alert(
//           "Ride Taken",
//           data.message || "This ride has already been accepted by another driver."
//         );
//       }
//     };

//     const handleRideStarted = (data: any) => {
//       if (!isMounted.current) return;
      
//       if (ride && ride.rideId === data.rideId) {
//         console.log("🎉 Ride started - showing verification modal");
        
//         setVerificationDetails({
//           pickup: ride.pickup.address || "Pickup location",
//           dropoff: ride.drop.address || "Dropoff location",
//           time: new Date().toLocaleTimeString(),
//           speed: currentSpeed,
//           distance: distanceSinceOtp.current,
//         });
        
//         setShowVerificationModal(true);
//       }
//     };

//     socket.on("connect", handleConnect);
//     socket.on("newRideRequest", handleRideRequest);
//     socket.on("userLiveLocationUpdate", handleUserLiveLocationUpdate);
//     socket.on("userDataForDriver", handleUserDataForDriver);
//     socket.on("rideOTP", handleRideOTP);
//     socket.on("disconnect", handleDisconnect);
//     socket.on("connect_error", handleConnectError);
//     socket.on("rideCancelled", handleRideCancelled);
//     socket.on("rideAlreadyAccepted", handleRideAlreadyAccepted);
//     socket.on("rideStarted", handleRideStarted);
    
//     // 🆕 Removed unconditional socket.connect() - now handled by online status useEffect
    
//     return () => {
//       socket.off("connect", handleConnect);
//       socket.off("newRideRequest", handleRideRequest);
//       socket.off("userLiveLocationUpdate", handleUserLiveLocationUpdate);
//       socket.off("userDataForDriver", handleUserDataForDriver);
//       socket.off("rideOTP", handleRideOTP);
//       socket.off("disconnect", handleDisconnect);
//       socket.off("connect_error", handleConnectError);
//       socket.off("rideCancelled", handleRideCancelled);
//       socket.off("rideAlreadyAccepted", handleRideAlreadyAccepted);
//       socket.off("rideStarted", handleRideStarted);
//     };
//   }, [location, driverId, driverName, ride, rideStatus, userData, stopNavigation, currentSpeed, isDriverOnline, clearMapData]);

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

//   if (!location) {
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
//           latitude: location.latitude,
//           longitude: location.longitude,
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
       
//         {/* 🆕 RED ROUTE - Dynamic polyline after OTP (pickup to drop) */}
//         {rideStatus === "started" && visibleRouteCoords.length > 0 && (
//           <Polyline
//             coordinates={visibleRouteCoords}
//             strokeWidth={6}
//             strokeColor="#F44336"
//             lineCap="round"
//             lineJoin="round"
//           />
//         )}
       
//         {/* 🆕 GREEN ROUTE - Dynamic polyline before OTP (driver to pickup) */}
//         {rideStatus === "accepted" && visibleRouteCoords.length > 0 && (
//           <Polyline
//             coordinates={visibleRouteCoords}
//             strokeWidth={5}
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

//       {/* 🆕 Online/Offline Toggle Button */}
//       {!ride && (
//         <View style={styles.onlineToggleContainer}>
//           <TouchableOpacity
//             style={[
//               styles.onlineToggleButton,
//               isDriverOnline ? styles.onlineButton : styles.offlineButton
//             ]}
//             onPress={toggleOnlineStatus}
//           >
//             <View style={styles.toggleContent}>
//               <View style={[
//                 styles.toggleIndicator,
//                 { backgroundColor: isDriverOnline ? "#4caf50" : "#f44336" }
//               ]} />
//               <Text style={styles.toggleButtonText}>
//                 {isDriverOnline ? "🟢 ONLINE" : "🔴 OFFLINE"}
//               </Text>
//             </View>
//             {backgroundTrackingActive && (
//               <Text style={styles.trackingText}>📍 Live tracking active</Text>
//             )}
//           </TouchableOpacity>
//         </View>
//       )}

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

//       {/* 🆕 Test Notification Button */}
//       {!ride && (
//         <TouchableOpacity
//           style={[styles.button, styles.testNotificationButton]}
//           onPress={testNotification}
//         >
//           <Text style={styles.btnText}>Test Notification</Text>
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
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// };

// export default DriverScreen;

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
//   // 🆕 Online/Offline Toggle Styles
//   onlineToggleContainer: {
//     position: "absolute",
//     top: Platform.OS === "ios" ? 120 : 110,
//     left: 16,
//     right: 16,
//     zIndex: 10,
//   },
//   onlineToggleButton: {
//     padding: 16,
//     borderRadius: 12,
//     elevation: 6,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 3 },
//     shadowOpacity: 0.2,
//     shadowRadius: 6,
//   },
//   onlineButton: {
//     backgroundColor: "#4caf50",
//   },
//   offlineButton: {
//     backgroundColor: "#f44336",
//   },
//   toggleContent: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   toggleIndicator: {
//     width: 12,
//     height: 12,
//     borderRadius: 6,
//     marginRight: 10,
//   },
//   toggleButtonText: {
//     color: "#fff",
//     fontSize: 18,
//     fontWeight: "700",
//   },
//   trackingText: {
//     color: "#fff",
//     fontSize: 11,
//     marginTop: 4,
//     textAlign: "center",
//     fontWeight: "500",
//   },
//   statusContainer: {
//     position: "absolute",
//     top: Platform.OS === "ios" ? 50 : 40,
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
//     bottom: 80,
//     left: 16,
//     right: 16,
//   },
//   testNotificationButton: {
//     backgroundColor: "#9c27b0",
//     margin: 16,
//     position: "absolute",
//     bottom: 140,
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
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
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
// });

