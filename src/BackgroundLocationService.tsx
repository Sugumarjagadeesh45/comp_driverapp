import BackgroundActions from "react-native-background-actions";
import Geolocation from "@react-native-community/geolocation";
import socketModule, {
  connectSocket,
  disconnectSocket,
  reconnectSocket,
  enableAutoReconnect,
  disableAutoReconnect,
  isSocketConnected,
} from "./socket";
import AsyncStorage from "@react-native-async-storage/async-storage";

const sleep = (time: number) => new Promise((resolve) => setTimeout(resolve, time));

// Add to BackgroundLocationService.tsx
export async function checkPendingNotificationsInBackground() {
  try {
    const pendingRide = await AsyncStorage.getItem('pendingRideRequest');
    if (pendingRide) {
      console.log('📱 Background: Processing pending notification');
      // You might need to use a headless JS task here
    }
  } catch (error) {
    console.error('Background notification check error:', error);
  }
}


export async function startBackgroundService() {
  const options = {
    taskName: "DriverBackground",
    taskTitle: "EAZY GO: You are Online",
    taskDesc: "Sharing live location with passengers",
    taskIcon: {
      name: "ic_launcher",
      type: "mipmap",
    },
    color: "#4caf50",
    linkingURI: "", // optional deep link on notification tap
    parameters: {
      delay: 15000, // 15s between location pushes
    },
  };

  const task = async (taskData: any) => {
    console.log("BackgroundLocationService: starting task");

    // Ensure socket connected once
    try {
      enableAutoReconnect();
      connectSocket();
    } catch (e) {
      console.warn("BackgroundLocationService: socket connect error", e);
    }

    // Loop while service is running
    while (BackgroundActions.isRunning()) {
      try {
        // Get current position (use getCurrentPosition to keep single-shot)
        await new Promise<void>((resolve) => {
          Geolocation.getCurrentPosition(
            async (pos) => {
              try {
                const driverId = (await AsyncStorage.getItem("driverId")) || null;
                const driverName = (await AsyncStorage.getItem("driverName")) || null;

                const payload = {
                  driverId,
                  driverName,
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  speed: pos.coords.speed || 0,
                  timestamp: new Date().toISOString(),
                  isBackground: true,
                };

                // emit over socket if connected
                if (isSocketConnected()) {
                  const s = connectSocket(); // ensures instance
                  s.emit("driverLocationUpdate", payload);
                } else {
                  // attempt reconnect if not connected
                  reconnectSocket();
                }
              } catch (e) {
                console.warn("BackgroundLocationService: emit error", e);
              } finally {
                resolve();
              }
            },
            (err) => {
              console.warn("BackgroundLocationService: geo error", err);
              // still attempt reconnect if socket down
              if (!isSocketConnected()) reconnectSocket();
              resolve();
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
          );
        });
      } catch (err) {
        console.error("BackgroundLocationService: task loop error", err);
      }

      // sleep for configured delay
      await sleep(taskData.delay || 15000);
    }

    console.log("BackgroundLocationService: task finished");
  };

  try {
    if (!BackgroundActions.isRunning()) {
      await BackgroundActions.start(task, options);
      console.log("BackgroundLocationService: BackgroundActions started");
    } else {
      console.log("BackgroundLocationService: already running");
    }
  } catch (err) {
    console.warn("BackgroundLocationService: start error", err);
  }
}

export async function stopBackgroundService() {
  try {
    // disable auto reconnect then optionally disconnect
    disableAutoReconnect();
    disconnectSocket();

    if (BackgroundActions.isRunning()) {
      await BackgroundActions.stop();
      console.log("BackgroundLocationService: BackgroundActions stopped");
    } else {
      console.log("BackgroundLocationService: not running");
    }
  } catch (err) {
    console.warn("BackgroundLocationService: stop error", err);
  }
}