// animationUtils.js
import { withTiming, withSpring, Easing } from 'react-native-reanimated';

// Haversine distance calculation
export const haversine = (start, end) => {
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

// Calculate distance in meters
export const calculateDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distanceKm = R * c;
  return distanceKm * 1000;
};

// Smooth position animation
export const animatePosition = (target, newValue, duration = 15000) => {
  return withTiming(newValue, {
    duration: Math.max(1000, Math.min(duration, 30000)), // Clamp between 1-30 seconds
    easing: Easing.inOut(Easing.quad),
  });
};

// Smooth rotation animation
export const animateRotation = (target, newValue) => {
  return withSpring(newValue, {
    damping: 15,
    mass: 1,
    stiffness: 150,
    overshootClamping: false,
    restDisplacementThreshold: 0.01,
    restSpeedThreshold: 2,
  });
};

// Calculate bearing between two points
export const calculateBearing = (startLat, startLng, endLat, endLng) => {
  const startLatRad = (startLat * Math.PI) / 180;
  const startLngRad = (startLng * Math.PI) / 180;
  const endLatRad = (endLat * Math.PI) / 180;
  const endLngRad = (endLng * Math.PI) / 180;

  const y = Math.sin(endLngRad - startLngRad) * Math.cos(endLatRad);
  const x =
    Math.cos(startLatRad) * Math.sin(endLatRad) -
    Math.sin(startLatRad) * Math.cos(endLatRad) * Math.cos(endLngRad - startLngRad);
  
  let bearing = Math.atan2(y, x);
  bearing = (bearing * 180) / Math.PI;
  bearing = (bearing + 360) % 360;
  
  return bearing;
};

// Interpolate between coordinates
export const interpolateCoordinate = (prevCoord, nextCoord, progress) => {
  if (!prevCoord || !nextCoord) return nextCoord || prevCoord;
  
  return {
    latitude: prevCoord.latitude + (nextCoord.latitude - prevCoord.latitude) * progress,
    longitude: prevCoord.longitude + (nextCoord.longitude - prevCoord.longitude) * progress,
  };
};

// Calculate animation duration based on distance
export const calculateAnimationDuration = (distance, baseDuration = 15000) => {
  const minDuration = 2000; // 2 seconds minimum
  const maxDuration = 30000; // 30 seconds maximum
  const duration = Math.min(maxDuration, Math.max(minDuration, distance * 100));
  return duration;
};