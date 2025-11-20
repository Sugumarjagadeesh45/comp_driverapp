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
  Animated,
  Easing,
  ScrollView,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import Geolocation from "@react-native-community/geolocation";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "./apiConfig";
import api from "../utils/api";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import FontAwesome from "react-native-vector-icons/FontAwesome";
import BackgroundTimer from 'react-native-background-timer';
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
  rating?: number;
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

  // App state management
  const [isAppActive, setIsAppActive] = useState(true);

  // New states for verification and bill
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [billDetails, setBillDetails] = useState({
    distance: '0 km',
    travelTime: '0 mins',
    charge: 0,
    userName: '',
    userMobile: '',
    baseFare: 0,
    timeCharge: 0,
    tax: 0
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
  
  // Online/Offline toggle state
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [backgroundTrackingActive, setBackgroundTrackingActive] = useState(false);
 
  // FCM Notification states
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
  const [isBackgroundMode, setIsBackgroundMode] = useState(false);
  
  // Animation values
  const driverMarkerAnimation = useRef(new Animated.Value(1)).current;
  const polylineAnimation = useRef(new Animated.Value(0)).current;
  
  // Enhanced UI states - DEFAULT TO MAXIMIZED
  const [riderDetailsVisible, setRiderDetailsVisible] = useState(true);
  const slideAnim = useRef(new Animated.Value(0)).current; // Start at 0 for maximized
  const fadeAnim = useRef(new Animated.Value(1)).current;  // Start at 1 for maximized
  
  // Refs for optimization
  const isMounted = useRef(true);
  const locationUpdateCount = useRef(0);
  const mapAnimationInProgress = useRef(false);
  const navigationInterval = useRef<NodeJS.Timeout | null>(null);
  const lastLocationUpdate = useRef<LocationType | null>(null);
  const routeUpdateThrottle = useRef<NodeJS.Timeout | null>(null);
  const distanceSinceOtp = useRef(0);
  const lastLocationBeforeOtp = useRef<LocationType | null>(null);
  const geolocationWatchId = useRef<number | null>(null);
  const backgroundLocationInterval = useRef<NodeJS.Timeout | null>(null);
  const driverMarkerRef = useRef<any>(null);
  
  // Store OTP verification location
  const [otpVerificationLocation, setOtpVerificationLocation] = useState<LocationType | null>(null);
  
  // Alert for ride already taken
  const [showRideTakenAlert, setShowRideTakenAlert] = useState(false);
  const rideTakenAlertTimeout = useRef<NodeJS.Timeout | null>(null);
  const [alertProgress, setAlertProgress] = useState(new Animated.Value(1));
  
  // Socket import
  let socket: any = null;
  try {
    socket = require("./socket").default;
  } catch (error) {
    console.warn("⚠️ Socket not available:", error);
  }
  
  // ============ PASSENGER DATA FUNCTIONS ============
  
  // Fetch passenger data function
  const fetchPassengerData = useCallback((rideData: RideType): UserDataType => {
    console.log("👤 Extracting passenger data from ride:", rideData.rideId);

    const userDataWithId: UserDataType = {
      name: rideData.userName || "Passenger",
      mobile: rideData.userMobile || "N/A",
      location: rideData.pickup,
      userId: rideData.rideId,
      rating: 4.8,
    };

    console.log("✅ Passenger data extracted successfully:", userDataWithId);
    return userDataWithId;
  }, []);

  // Calculate initials for avatar
  const calculateInitials = (name: string): string => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  // Call passenger function
  const handleCallPassenger = () => {
    if (userData?.mobile) {
      Linking.openURL(`tel:${userData.mobile}`)
        .catch(err => console.error('Error opening phone dialer:', err));
    } else {
      Alert.alert("Error", "Passenger mobile number not available");
    }
  };

  // Message passenger function
  const handleMessagePassenger = () => {
    if (userData?.mobile) {
      Linking.openURL(`sms:${userData.mobile}`)
        .catch(err => console.error('Error opening message app:', err));
    } else {
      Alert.alert("Error", "Passenger mobile number not available");
    }
  };

  // Animation functions for rider details
  const showRiderDetails = () => {
    setRiderDetailsVisible(true);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      })
    ]).start();
  };

  const hideRiderDetails = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 400, // Slide down completely
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      })
    ]).start(() => {
      setRiderDetailsVisible(false);
    });
  };

  const toggleRiderDetails = () => {
    if (riderDetailsVisible) {
      hideRiderDetails();
    } else {
      showRiderDetails();
    }
  };
  
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
  
  // Save ride state to AsyncStorage for persistence
  const saveRideState = useCallback(async () => {
    try {
      const rideState = {
        ride,
        userData,
        rideStatus,
        driverStatus,
        travelledKm,
        distanceSinceOtp: distanceSinceOtp.current,
        lastLocationBeforeOtp: lastLocationBeforeOtp.current,
        otpVerificationLocation,
        fullRouteCoords,
        visibleRouteCoords,
        userLocation,
        lastCoord,
        riderDetailsVisible // Save UI state
      };
      
      await AsyncStorage.setItem('rideState', JSON.stringify(rideState));
      console.log('✅ Ride state saved to AsyncStorage');
    } catch (error) {
      console.error('❌ Error saving ride state:', error);
    }
  }, [ride, userData, rideStatus, driverStatus, travelledKm, otpVerificationLocation, 
      fullRouteCoords, visibleRouteCoords, userLocation, lastCoord, riderDetailsVisible]);
  
  // Restore ride state from AsyncStorage
  const restoreRideState = useCallback(async () => {
    try {
      const savedState = await AsyncStorage.getItem('rideState');
      if (savedState) {
        const rideState = JSON.parse(savedState);
        
        // Only restore if there's an active ride
        if (rideState.ride && (rideState.rideStatus === 'accepted' || rideState.rideStatus === 'started')) {
          console.log('🔄 Restoring ride state from AsyncStorage');
          
          setRide(rideState.ride);
          setUserData(rideState.userData);
          setRideStatus(rideState.rideStatus);
          setDriverStatus(rideState.driverStatus);
          setTravelledKm(rideState.travelledKm || 0);
          distanceSinceOtp.current = rideState.distanceSinceOtp || 0;
          lastLocationBeforeOtp.current = rideState.lastLocationBeforeOtp;
          setOtpVerificationLocation(rideState.otpVerificationLocation);
          setFullRouteCoords(rideState.fullRouteCoords || []);
          setVisibleRouteCoords(rideState.visibleRouteCoords || []);
          setUserLocation(rideState.userLocation);
          setLastCoord(rideState.lastCoord);
          
          // Restore UI state - DEFAULT TO MAXIMIZED
          const shouldShowMaximized = rideState.riderDetailsVisible !== false; // Default to true
          setRiderDetailsVisible(shouldShowMaximized);
          
          if (shouldShowMaximized) {
            slideAnim.setValue(0);
            fadeAnim.setValue(1);
          } else {
            slideAnim.setValue(400);
            fadeAnim.setValue(0);
          }
          
          console.log('✅ Ride state restored successfully');
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('❌ Error restoring ride state:', error);
      return false;
    }
  }, []);
  
  // Clear ride state from AsyncStorage
  const clearRideState = useCallback(async () => {
    try {
      await AsyncStorage.removeItem('rideState');
      console.log('✅ Ride state cleared from AsyncStorage');
    } catch (error) {
      console.error('❌ Error clearing ride state:', error);
    }
  }, []);
  
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
      if (rideTakenAlertTimeout.current) {
        clearTimeout(rideTakenAlertTimeout.current);
      }
      // Clean up notification listeners
      NotificationService.off('rideRequest', handleNotificationRideRequest);
      NotificationService.off('tokenRefresh', () => {});
    };
  }, []);
  
  // App state management
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      console.log('📱 App state changed:', nextAppState);
      
      if (nextAppState === 'background') {
        setIsAppActive(false);
        // Save state when app goes to background
        if (ride && (rideStatus === "accepted" || rideStatus === "started")) {
          saveRideState();
        }
      } else if (nextAppState === 'active') {
        setIsAppActive(true);
        // When app comes to foreground, try to restore state if needed
        if (!ride) {
          restoreRideState();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription.remove();
    };
  }, [ride, rideStatus, saveRideState, restoreRideState]);
  
  // Background location tracking with regular geolocation
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
  
  // Stop background location tracking
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
  
  // FCM: Initialize notification system
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
        // Don't block app if notifications fail
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
  
  // FCM: Send token to server
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
  
  // FCM: Handle notification ride request
  const handleNotificationRideRequest = (data: any) => {
    console.log('📱 Received ride request via notification:', data);
   
    if (!data || data.type !== 'ride_request') {
      console.error('Invalid ride request payload:', data);
      return;
    }
   
    // Parse pickup and drop locations if they're strings
    let pickupLocation, dropLocation;
    
    try {
      if (typeof data.pickup === 'string') {
        pickupLocation = JSON.parse(data.pickup);
      } else {
        pickupLocation = data.pickup;
      }
      
      if (typeof data.drop === 'string') {
        dropLocation = JSON.parse(data.drop);
      } else {
        dropLocation = data.drop;
      }
    } catch (error) {
      console.error('Error parsing location data:', error);
      return;
    }
   
    const rideData: RideType = {
      rideId: data.rideId,
      RAID_ID: data.RAID_ID || "N/A",
      otp: data.otp || "0000",
      pickup: {
        latitude: pickupLocation?.lat || pickupLocation?.latitude || 0,
        longitude: pickupLocation?.lng || pickupLocation?.longitude || 0,
        address: pickupLocation?.address || "Unknown location",
      },
      drop: {
        latitude: dropLocation?.lat || dropLocation?.latitude || 0,
        longitude: dropLocation?.lng || dropLocation?.longitude || 0,
        address: dropLocation?.address || "Unknown location",
      },
      fare: parseFloat(data.fare) || 0,
      distance: data.distance || "0 km",
      userName: data.userName || data.customerName || "Customer",
      userMobile: data.userMobile || "N/A",
    };
   
    console.log('📱 Processed ride data:', rideData);
    handleRideRequest(rideData);
  };
  
  // Toggle Online/Offline Status
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
          
          // Try to restore ride state if there was an active ride
          const rideRestored = await restoreRideState();
          if (rideRestored) {
            console.log("✅ Active ride restored from previous session");
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
  }, [driverId, driverName, navigation, location, restoreRideState]);
  
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
  
  // Route fetching with real-time updates
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
  
  // Update visible route as driver moves (Dynamic Polyline) - FIXED FOR POST-OTP
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
    }, 500);
  }, [updateVisibleRoute]);
  
  // Automatically update route as driver moves - FIXED FOR POST-OTP
  useEffect(() => {
    if (rideStatus === "started" && fullRouteCoords.length > 0) {
      throttledUpdateVisibleRoute();
    }
  }, [location, rideStatus, fullRouteCoords, throttledUpdateVisibleRoute]);
  
  // Update pickup route as driver moves
  const updatePickupRoute = useCallback(async () => {
    if (!location || !ride || rideStatus !== "accepted") return;
    
    console.log("🗺️ Updating pickup route as driver moves");
    
    try {
      const pickupRoute = await fetchRoute(location, ride.pickup);
      if (pickupRoute && pickupRoute.length > 0) {
        setRide((prev) => {
          if (!prev) return null;
          console.log("✅ Updated pickup route with", pickupRoute.length, "points");
          return { ...prev, routeCoords: pickupRoute };
        });
      }
    } catch (error) {
      console.error("❌ Error updating pickup route:", error);
    }
  }, [location, ride, rideStatus, fetchRoute]);
  
  // Throttled pickup route update
  const throttledUpdatePickupRoute = useCallback(() => {
    if (routeUpdateThrottle.current) {
      clearTimeout(routeUpdateThrottle.current);
    }
   
    routeUpdateThrottle.current = setTimeout(() => {
      updatePickupRoute();
    }, 2000);
  }, [updatePickupRoute]);
  
  // Update pickup route as driver moves
  useEffect(() => {
    if (rideStatus === "accepted" && location && ride) {
      throttledUpdatePickupRoute();
    }
  }, [location, rideStatus, ride, throttledUpdatePickupRoute]);
  
  // Update drop route as driver moves after OTP
  const updateDropRoute = useCallback(async () => {
    if (!location || !ride || rideStatus !== "started") return;
    
    console.log("🗺️ Updating drop route as driver moves after OTP");
    
    try {
      const dropRoute = await fetchRoute(location, ride.drop);
      if (dropRoute && dropRoute.length > 0) {
        setFullRouteCoords(dropRoute);
        setVisibleRouteCoords(dropRoute);
        console.log("✅ Updated drop route with", dropRoute.length, "points");
      }
    } catch (error) {
      console.error("❌ Error updating drop route:", error);
    }
  }, [location, ride, rideStatus, fetchRoute]);
  
  // Throttled drop route update
  const throttledUpdateDropRoute = useCallback(() => {
    if (routeUpdateThrottle.current) {
      clearTimeout(routeUpdateThrottle.current);
    }
   
    routeUpdateThrottle.current = setTimeout(() => {
      updateDropRoute();
    }, 3000); // Update every 3 seconds
  }, [updateDropRoute]);
  
  // Update drop route as driver moves
  useEffect(() => {
    if (rideStatus === "started" && location && ride) {
      throttledUpdateDropRoute();
    }
  }, [location, rideStatus, ride, throttledUpdateDropRoute]);
  
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
  
  // Start navigation (called after OTP verification) - FIXED FOR REAL-TIME UPDATES
  const startNavigation = useCallback(async () => {
    if (!ride?.drop) return;
    console.log("🚀 Starting navigation from OTP verification location to drop location");
  
    try {
      // Use OTP verification location as starting point instead of original pickup
      const routeCoords = await fetchRoute(otpVerificationLocation || location, ride.drop);
      if (routeCoords && routeCoords.length > 0) {
        console.log("✅ Navigation route fetched successfully:", routeCoords.length, "points");
      
        setFullRouteCoords(routeCoords);
        setVisibleRouteCoords(routeCoords);
      
        // Start periodic route re-fetching for real-time updates (every 10 seconds)
        if (navigationInterval.current) clearInterval(navigationInterval.current);
        navigationInterval.current = setInterval(async () => {
          if (rideStatus === "started" && location) {
            console.log("🔄 Re-fetching optimized route from current location to drop");
            const updatedRoute = await fetchRoute(location, ride.drop);
            if (updatedRoute && updatedRoute.length > 0) {
              setFullRouteCoords(updatedRoute);
              setVisibleRouteCoords(updatedRoute);
            }
          }
        }, 10000); // Re-fetch every 10 seconds
      
        console.log("🗺️ Navigation started with real-time route updates from current location to drop");
      }
    } catch (error) {
      console.error("❌ Error starting navigation:", error);
    }
  }, [ride?.drop, fetchRoute, otpVerificationLocation, location, rideStatus]);
  
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
            // Use the enhanced passenger data function
            const passengerData = fetchPassengerData(ride!);
            if (passengerData) {
              setUserData(passengerData);
              console.log("✅ Passenger data set:", passengerData);
            }
            
            const initialUserLocation = {
              latitude: response.pickup.lat,
              longitude: response.pickup.lng,
            };
           
            setUserLocation(initialUserLocation);
           
            // Generate dynamic route from driver to pickup (GREEN ROUTE)
            if (location) {
              try {
                const pickupRoute = await fetchRoute(location, initialUserLocation);
                if (pickupRoute) {
                  setRide((prev) => {
                    if (!prev) return null;
                    console.log("✅ Driver to pickup route generated with", pickupRoute.length, "points");
                    return { ...prev, routeCoords: pickupRoute };
                  });
                }
              } catch (error) {
                console.error("❌ Error generating pickup route:", error);
              }
            
              animateToLocation(initialUserLocation, true);
            }
            
            // DEFAULT TO MAXIMIZED VIEW - Show rider details automatically when ride is accepted
            setRiderDetailsVisible(true);
            slideAnim.setValue(0);
            fadeAnim.setValue(1);
            
            // Emit event to notify other drivers that this ride has been taken
            socket.emit("rideTakenByDriver", {
              rideId: currentRideId,
              driverId: driverId,
              driverName: driverName,
            });
            
            socket.emit("driverAcceptedRide", {
              rideId: currentRideId,
              driverId: driverId,
              userId: response.userId,
              driverLocation: location,
            });
           
            setTimeout(() => {
              socket.emit("getUserDataForDriver", { rideId: currentRideId });
            }, 1000);
            
            // Save ride state after accepting
            saveRideState();
          }
        }
      );
    }
  };
  
  // Reject ride
  const rejectRide = (rideId?: string) => {
    const currentRideId = rideId || ride?.rideId;
    if (!currentRideId) return;
   
    // Clean map data
    clearMapData();
   
    setRide(null);
    setRideStatus("idle");
    setDriverStatus("online");
    setUserData(null);
    setUserLocation(null);
    hideRiderDetails();
   
    if (socket) {
      socket.emit("rejectRide", {
        rideId: currentRideId,
        driverId,
      });
    }
   
    Alert.alert("Ride Rejected ❌", "You rejected the ride");
  };
  
  // Clear all map data (markers, routes, polylines)
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
    // Clear OTP verification location
    setOtpVerificationLocation(null);
   
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
     
      // IMPORTANT: Store the OTP verification location
      setOtpVerificationLocation(location);
      console.log("📍 OTP verification location stored:", location);
     
      setOtpSharedTime(new Date());
      setRideStatus("started");
      setOtpModalVisible(false);
      setEnteredOtp("");
     
      console.log("✅ OTP Verified - Starting navigation from OTP verification location to drop");
     
      if (ride.drop) {
        // Start navigation with dynamic route from OTP verification location to drop (RED ROUTE)
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
      
      // Save ride state after OTP verification
      saveRideState();
    } else {
      Alert.alert("Invalid OTP", "Please check the OTP and try again.");
    }
  };
  
  const completeRide = async () => {
    if (!ride || !location || !otpVerificationLocation) return;
   
    stopNavigation();
   
    try {
      // FIXED: Calculate distance between OTP verification location and current location
      const distance = haversine(otpVerificationLocation, location) / 1000; // in km
      
      // Calculate fare based on distance and admin-set rate
      const farePerKm = ride.fare || 15; // Default to 15 if not set
      const finalFare = distance * farePerKm;
     
      console.log(`💰 CORRECT Final fare calculation:`);
      console.log(`📍 OTP Verification Location: ${otpVerificationLocation.latitude.toFixed(6)}, ${otpVerificationLocation.longitude.toFixed(6)}`);
      console.log(`📍 Current Location: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`);
      console.log(`📏 Distance: ${distance.toFixed(2)}km`);
      console.log(`💰 Rate per km: ₹${farePerKm}`);
      console.log(`💰 Final Fare: ₹${finalFare.toFixed(2)}`);
     
      setBillDetails({
        distance: `${distance.toFixed(2)} km`,
        travelTime: `${Math.round(distance * 10)} mins`,
        charge: Math.round(finalFare),
        userName: userData?.name || 'Customer',
        userMobile: userData?.mobile || 'N/A',
        baseFare: 0, // No base fare as per requirement
        timeCharge: 0, // No time charge as per requirement
        tax: 0 // No tax as per requirement
      });
     
      setShowBillModal(true);
     
      if (socket) {
        socket.emit("driverCompletedRide", {
          rideId: ride.rideId,
          driverId: driverId,
          userId: userData?.userId,
          distance: distance,
          fare: finalFare,
          // Send actual pickup and drop locations for billing
          actualPickup: otpVerificationLocation,
          actualDrop: location
        });
       
        socket.emit("completeRide", {
          rideId: ride.rideId,
          driverId,
          distance: distance,
          fare: finalFare,
          // Send actual pickup and drop locations for billing
          actualPickup: otpVerificationLocation,
          actualDrop: location
        });
      }
     
    } catch (error) {
      console.error("❌ Error completing ride:", error);
      Alert.alert("Error", "Failed to complete ride. Please try again.");
    }
  };
  
  // Handle bill modal close with map cleanup
  const handleBillModalClose = () => {
    setShowBillModal(false);
    setRideStatus("completed");
    setDriverStatus("online");
   
    // Clean all map data after ride completion
    clearMapData();
   
    // Reset all ride states
    setRide(null);
    setUserData(null);
    setOtpSharedTime(null);
    // Clear OTP verification location
    setOtpVerificationLocation(null);
    hideRiderDetails();
    
    // Clear ride state from AsyncStorage
    clearRideState();
   
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
      // Parse pickup and drop locations if they're strings
      let pickupLocation, dropLocation;
      
      try {
        if (typeof data.pickup === 'string') {
          pickupLocation = JSON.parse(data.pickup);
        } else {
          pickupLocation = data.pickup;
        }
        
        if (typeof data.drop === 'string') {
          dropLocation = JSON.parse(data.drop);
        } else {
          dropLocation = data.drop;
        }
      } catch (error) {
        console.error('Error parsing location data:', error);
        return;
      }
      
      const rideData: RideType = {
        rideId: data.rideId,
        RAID_ID: data.RAID_ID || "N/A",
        otp: data.otp || "0000",
        pickup: {
          latitude: pickupLocation?.lat || pickupLocation?.latitude || 0,
          longitude: pickupLocation?.lng || pickupLocation?.longitude || 0,
          address: pickupLocation?.address || "Unknown location",
        },
        drop: {
          latitude: dropLocation?.lat || dropLocation?.latitude || 0,
          longitude: dropLocation?.lng || dropLocation?.longitude || 0,
          address: dropLocation?.address || "Unknown location",
        },
        fare: parseFloat(data.fare) || 0,
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
  
  // Show ride taken alert
  const showRideTakenAlertMessage = useCallback(() => {
    setShowRideTakenAlert(true);
    
    // Clear any existing timeout
    if (rideTakenAlertTimeout.current) {
      clearTimeout(rideTakenAlertTimeout.current);
    }
    
    // Animate the progress bar
    Animated.timing(alertProgress, {
      toValue: 0,
      duration: 7000, // 7 seconds
      useNativeDriver: false,
    }).start();
    
    // Set new timeout to hide alert after 7 seconds
    rideTakenAlertTimeout.current = setTimeout(() => {
      setShowRideTakenAlert(false);
      // Reset the progress bar for next time
      alertProgress.setValue(1);
    }, 7000);
  }, [alertProgress]);
  
  // Render professional maximized passenger details (screenshot layout)
  const renderMaximizedPassengerDetails = () => {
    if (!ride || !userData || !riderDetailsVisible) return null;

    return (
      <Animated.View 
        style={[
          styles.maximizedDetailsContainer,
          {
            transform: [{ translateY: slideAnim }],
            opacity: fadeAnim
          }
        ]}
      >
        {/* Header with Branding and Down Arrow */}
        <View style={styles.maximizedHeader}>
          <View style={styles.brandingContainer}>
            <Text style={styles.brandingText}>Webase branding</Text>
          </View>
          <TouchableOpacity onPress={hideRiderDetails} style={styles.minimizeButton}>
            <MaterialIcons name="keyboard-arrow-down" size={28} color="#666" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView style={styles.maximizedContent} showsVerticalScrollIndicator={false}>
          {/* Contact Information */}
          <View style={styles.contactSection}>
            <View style={styles.contactRow}>
              <MaterialIcons name="phone" size={20} color="#666" />
              <Text style={styles.contactLabel}>Phone</Text>
              <Text style={styles.contactValue}>{userData.mobile}</Text>
            </View>
          </View>

          {/* Address Information - FIXED: Show both pickup and drop-off addresses separately */}
          <View style={styles.addressSection}>
            <View style={styles.addressRow}>
              <MaterialIcons name="location-on" size={20} color="#666" />
              <Text style={styles.addressLabel}>Pick-up location</Text>
            </View>
            <Text style={styles.addressText}>
              {ride.pickup.address}
            </Text>
            
            <View style={[styles.addressRow, { marginTop: 16 }]}>
              <MaterialIcons name="location-on" size={20} color="#666" />
              <Text style={styles.addressLabel}>Drop-off location</Text>
            </View>
            <Text style={styles.addressText}>
              {ride.drop.address}
            </Text>
          </View>

          {/* Fare Information */}
          <View style={styles.fareSection}>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Estimated fare</Text>
              <Text style={styles.fareAmount}>₹{ride.fare}</Text>
            </View>
          </View>
        </ScrollView>

        {/* Bottom Action Button */}
        <TouchableOpacity 
          style={styles.startRideButton}
          onPress={() => setOtpModalVisible(true)}
        >
          <Text style={styles.startRideButtonText}>Enter OTP & Start Ride</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  // Render minimized booking bar (2 lines as specified)
  const renderMinimizedBookingBar = () => {
    if (!ride || !userData || riderDetailsVisible) return null;

    return (
      <View style={styles.minimizedBookingBarContainer}>
        <View style={styles.minimizedBookingBar}>
          {/* Line 1: Profile Image, Name, Maximize Arrow */}
          <View style={styles.minimizedFirstRow}>
            <View style={styles.minimizedProfileImage}>
              <Text style={styles.minimizedProfileImageText}>
                {calculateInitials(userData.name)}
              </Text>
            </View>
            <Text style={styles.minimizedProfileName} numberOfLines={1}>
              {userData.name}
            </Text>
            <TouchableOpacity 
              style={styles.minimizedExpandButton}
              onPress={showRiderDetails}
            >
              <MaterialIcons name="keyboard-arrow-up" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          {/* Line 2: Phone Icon, Mobile Number, Call Button */}
          <View style={styles.minimizedSecondRow}>
            <View style={styles.minimizedMobileContainer}>
              <MaterialIcons name="phone" size={16} color="#4CAF50" />
              <Text style={styles.minimizedMobileText} numberOfLines={1}>
                {userData.mobile}
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.minimizedCallButton}
              onPress={handleCallPassenger}
            >
              <MaterialIcons name="call" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // Socket event listeners for ride taken alerts
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
        // Parse pickup and drop locations if they're strings
        let pickupLocation, dropLocation;
        
        try {
          if (typeof data.pickup === 'string') {
            pickupLocation = JSON.parse(data.pickup);
          } else {
            pickupLocation = data.pickup;
          }
          
          if (typeof data.drop === 'string') {
            dropLocation = JSON.parse(data.drop);
          } else {
            dropLocation = data.drop;
          }
        } catch (error) {
          console.error('Error parsing location data:', error);
          return;
        }
        
        const rideData: RideType = {
          rideId: data.rideId,
          RAID_ID: data.RAID_ID || "N/A",
          otp: data.otp || "0000",
          pickup: {
            latitude: pickupLocation?.lat || pickupLocation?.latitude || 0,
            longitude: pickupLocation?.lng || pickupLocation?.longitude || 0,
            address: pickupLocation?.address || "Unknown location",
          },
          drop: {
            latitude: dropLocation?.lat || dropLocation?.latitude || 0,
            longitude: dropLocation?.lng || dropLocation?.longitude || 0,
            address: dropLocation?.address || "Unknown location",
          },
          fare: parseFloat(data.fare) || 0,
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
       
        // Clean map after cancellation
        clearMapData();
       
        setRide(null);
        setUserData(null);
        setRideStatus("idle");
        setDriverStatus("online");
        hideRiderDetails();
        
        // Clear ride state from AsyncStorage
        clearRideState();
       
        Alert.alert("Ride Cancelled", "The passenger cancelled the ride.");
      }
    };
    
    const handleRideAlreadyAccepted = (data: any) => {
      if (!isMounted.current) return;
     
      // If this driver had ride request, clean up
      if (ride && ride.rideId === data.rideId) {
        // Clean map
        clearMapData();
       
        setRide(null);
        setUserData(null);
        setRideStatus("idle");
        setDriverStatus("online");
        hideRiderDetails();
      }
    };
    
    const handleRideTakenByDriver = (data: any) => {
      if (!isMounted.current) return;
      
      // Only show the alert if this driver is not the one who took the ride
      if (data.driverId !== driverId) {
        Alert.alert(
          "Ride Already Taken",
          data.message || "This ride has already been accepted by another driver. Please wait for the next ride request.",
          [{ text: "OK" }]
        );
        
        // If this driver had the ride request, clean up
        if (ride && ride.rideId === data.rideId) {
          // Clean map
          clearMapData();
         
          setRide(null);
          setUserData(null);
          setRideStatus("idle");
          setDriverStatus("online");
          hideRiderDetails();
        }
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
    socket.on("rideTakenByDriver", handleRideTakenByDriver);
    socket.on("rideStarted", handleRideStarted);
   
    // Socket connection based on online status
    if (isDriverOnline && !socket.connected) {
      socket.connect();
    } else if (!isDriverOnline && socket.connected) {
      socket.disconnect();
    }
   
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
      socket.off("rideTakenByDriver", handleRideTakenByDriver);
      socket.off("rideStarted", handleRideStarted);
    };
  }, [location, driverId, driverName, ride, rideStatus, userData, stopNavigation, currentSpeed, isDriverOnline, clearMapData, clearRideState]);
  
  // LOCATION TRACKING – new unified effect
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
              buttonPositive: "OK"
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
            distanceFilter: 5,          // tighter filter
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
  
  // Save ride state whenever it changes
  useEffect(() => {
    if (ride && (rideStatus === "accepted" || rideStatus === "started")) {
      saveRideState();
    }
  }, [ride, rideStatus, userData, travelledKm, otpVerificationLocation, riderDetailsVisible, saveRideState]);
  
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
        {/* Pickup Marker with Blue Icon */}
        {ride && rideStatus !== "started" && (
          <Marker
            coordinate={ride.pickup}
            title="Pickup Location"
            description={ride.pickup.address}
            pinColor="blue"
          >
            <View style={styles.locationMarker}>
              <MaterialIcons name="location-pin" size={32} color="#2196F3" />
              <Text style={styles.markerLabel}>Pickup</Text>
            </View>
          </Marker>
        )}
       
        {/* Drop-off Marker with Red Icon */}
        {ride && (
          <Marker
            coordinate={ride.drop}
            title="Drop Location"
            description={ride.drop.address}
            pinColor="red"
          >
            <View style={styles.locationMarker}>
              <MaterialIcons name="location-pin" size={32} color="#F44336" />
              <Text style={styles.markerLabel}>Drop-off</Text>
            </View>
          </Marker>
        )}
      
        {/* RED ROUTE - Dynamic polyline after OTP (OTP verification to drop) */}
        {rideStatus === "started" && visibleRouteCoords.length > 0 && (
          <Polyline
            coordinates={visibleRouteCoords}
            strokeWidth={6}
            strokeColor="#F44336"
            lineCap="round"
            lineJoin="round"
          />
        )}
      
        {/* GREEN ROUTE - Dynamic polyline before OTP (driver to pickup) */}
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
      
      {/* Professional Maximized Passenger Details (Default View) */}
      {renderMaximizedPassengerDetails()}
      
      {/* Minimized Booking Bar (2 lines) */}
      {renderMinimizedBookingBar()}

      {/* Single Bottom Button - Changes based on ride status */}
      {ride && (rideStatus === "accepted" || rideStatus === "started") && (
        <TouchableOpacity
          style={[
            styles.button, 
            rideStatus === "accepted" ? styles.startButton : styles.completeButton
          ]}
          onPress={rideStatus === "accepted" ? () => setOtpModalVisible(true) : completeRide}
        >
          <MaterialIcons 
            name={rideStatus === "accepted" ? "play-arrow" : "flag"} 
            size={24} 
            color="#fff" 
          />
          <Text style={styles.btnText}>
            {rideStatus === "accepted" ? "Enter OTP & Start Ride" : `Complete Ride (${distanceSinceOtp.current.toFixed(2)} km)`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Ride Taken Alert */}
      {showRideTakenAlert && (
        <View style={styles.rideTakenAlertContainer}>
          <View style={styles.rideTakenAlertContent}>
            <Text style={styles.rideTakenAlertText}>
              This ride is already taken by another driver — please wait.
            </Text>
            <View style={styles.alertProgressBar}>
              <Animated.View 
                style={[
                  styles.alertProgressFill,
                  {
                    width: '100%',
                    transform: [{ scaleX: alertProgress }]
                  }
                ]}
              />
            </View>
          </View>
        </View>
      )}
      
      {/* Online/Offline Toggle Button - MOVED TO BOTTOM RIGHT */}
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
              <>
                <MaterialIcons name="check-circle" size={24} color="#fff" />
                <Text style={styles.btnText}>Accept Ride</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.rejectButton]}
            onPress={() => rejectRide()}
          >
            <MaterialIcons name="cancel" size={24} color="#fff" />
            <Text style={styles.btnText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Logout Button */}
      {!ride && (
        <TouchableOpacity
          style={[styles.button, styles.logoutButton]}
          onPress={handleLogout}
        >
          <MaterialIcons name="logout" size={20} color="#fff" />
          <Text style={styles.btnText}>Logout</Text>
        </TouchableOpacity>
      )}
      
      {/* OTP Modal */}
      <Modal visible={otpModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Enter OTP</Text>
              <Text style={styles.modalSubtitle}>Please ask passenger for OTP to start the ride</Text>
            </View>
            <TextInput
              placeholder="Enter 4-digit OTP"
              value={enteredOtp}
              onChangeText={setEnteredOtp}
              keyboardType="numeric"
              style={styles.otpInput}
              maxLength={4}
              autoFocus
              placeholderTextColor="#999"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelModalButton]}
                onPress={() => setOtpModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmModalButton]}
                onPress={confirmOTP}
              >
                <Text style={styles.modalButtonText}>Confirm OTP</Text>
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🏁 Ride Completed</Text>
              <Text style={styles.modalSubtitle}>Thank you for the safe ride!</Text>
            </View>

            <View style={styles.billCard}>
              <View style={styles.billSection}>
                <Text style={styles.billSectionTitle}>Customer Details</Text>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Name:</Text>
                  <Text style={styles.billValue}>{billDetails.userName}</Text>
                </View>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Mobile:</Text>
                  <Text style={styles.billValue}>{billDetails.userMobile}</Text>
                </View>
              </View>

              <View style={styles.billSection}>
                <Text style={styles.billSectionTitle}>Trip Details</Text>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Distance:</Text>
                  <Text style={styles.billValue}>{billDetails.distance}</Text>
                </View>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Time:</Text>
                  <Text style={styles.billValue}>{billDetails.travelTime}</Text>
                </View>
              </View>

              <View style={styles.billSection}>
                <Text style={styles.billSectionTitle}>Fare Breakdown</Text>
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Distance Charge:</Text>
                  <Text style={styles.billValue}>₹{billDetails.charge}</Text>
                </View>
                <View style={styles.billDivider} />
                <View style={styles.billRow}>
                  <Text style={styles.billTotalLabel}>Total Amount:</Text>
                  <Text style={styles.billTotalValue}>₹{billDetails.charge}</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.confirmButton} onPress={handleBillModalClose}>
              <Text style={styles.confirmButtonText}>Confirm & Close Ride</Text>
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
    backgroundColor: "#1a1a1a",
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
  // Location Marker Styles
  locationMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#333',
    marginTop: -4,
  },
  // Professional Maximized Passenger Details (Screenshot Layout)
  maximizedDetailsContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
    elevation: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    maxHeight: "80%", // Increased height to ensure it covers the bottom button
  },
  maximizedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  brandingContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandingText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333333",
  },
  minimizeButton: {
    padding: 8,
  },
  maximizedContent: {
    flex: 1,
  },
  contactSection: {
    marginBottom: 20,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  contactLabel: {
    fontSize: 14,
    color: "#666666",
    marginLeft: 12,
    flex: 1,
  },
  contactValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333333",
  },
  addressSection: {
    marginBottom: 20,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  addressLabel: {
    fontSize: 14,
    color: "#666666",
    marginLeft: 12,
    fontWeight: "500",
  },
  addressText: {
    fontSize: 16,
    color: "#333333",
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  fareSection: {
    marginBottom: 20,
  },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  fareLabel: {
    fontSize: 16,
    color: "#666666",
    fontWeight: "500",
  },
  fareAmount: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#4CAF50",
  },
  startRideButton: {
    backgroundColor: "#2196F3",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  startRideButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  // Minimized Booking Bar Styles (2 lines)
  minimizedBookingBarContainer: {
    position: "absolute",
    bottom: 80,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  minimizedBookingBar: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  minimizedFirstRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  minimizedProfileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4CAF50",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  minimizedProfileImageText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  minimizedProfileName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333333",
    flex: 1,
  },
  minimizedExpandButton: {
    padding: 4,
  },
  minimizedSecondRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  minimizedMobileContainer: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  minimizedMobileText: {
    fontSize: 14,
    color: "#333333",
    marginLeft: 6,
    flex: 1,
  },
  minimizedCallButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#4CAF50",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  // Ride Taken Alert Styles
  rideTakenAlertContainer: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    zIndex: 20,
  },
  rideTakenAlertContent: {
    backgroundColor: "rgba(255, 152, 0, 0.9)",
    padding: 16,
    borderRadius: 8,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  rideTakenAlertText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  alertProgressBar: {
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 2,
    marginTop: 8,
    overflow: "hidden",
  },
  alertProgressFill: {
    height: "100%",
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  // Online/Offline Toggle Styles - MOVED TO BOTTOM RIGHT
  onlineToggleContainer: {
    position: "absolute",
    top: 120,
    right: 30,
    left: 'auto',
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
    minWidth: 330,
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
    fontSize: 16,
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
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  acceptButton: {
    backgroundColor: "#4caf50",
    flex: 1,
  },
  rejectButton: {
    backgroundColor: "#f44336",
    flex: 1,
  },
  startButton: {
    backgroundColor: "#2196f3",
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
  },
  completeButton: {
    backgroundColor: "#ff9800",
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
  },
  logoutButton: {
    backgroundColor: "#dc3545",
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
  },
  btnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 20,
  },
  modalContainer: {
    backgroundColor: "white",
    padding: 24,
    borderRadius: 20,
    width: "100%",
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  modalHeader: {
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    color: "#333",
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  otpInput: {
    borderWidth: 2,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    marginVertical: 16,
    padding: 20,
    fontSize: 20,
    textAlign: "center",
    fontWeight: "700",
    backgroundColor: "#f8f9fa",
    color: "#333",
  },
  modalButtons: {
    flexDirection: "row",
    marginTop: 8,
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cancelModalButton: {
    backgroundColor: "#757575",
  },
  confirmModalButton: {
    backgroundColor: "#4caf50",
  },
  modalButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  billCard: {
    backgroundColor: "#F8F9FA",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  billSection: {
    marginBottom: 20,
  },
  billSectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  billLabel: {
    fontSize: 14,
    color: "#666666",
    fontWeight: "500",
  },
  billValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333333",
  },
  billDivider: {
    height: 1,
    backgroundColor: "#DDDDDD",
    marginVertical: 12,
  },
  billTotalLabel: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333333",
  },
  billTotalValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#4CAF50",
  },
  confirmButton: {
    backgroundColor: "#4CAF50",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
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
    width: 14,
    height: 14,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
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
















