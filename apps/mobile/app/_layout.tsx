import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, Text, View } from 'react-native';
import { AuthProvider } from '@/lib/auth';
import { ApiError, trackEvent } from '@/lib/api';
import { colors, typography } from '@/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Most catalog and profile reads are safe to reuse briefly. Refetching
      // every time a tab regains focus made navigation feel like a loading
      // screen, especially when the API was waking up.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // A missing place/list should resolve immediately; retry only network
      // failures and server-side errors that may recover on the next attempt.
      retry: (failureCount, error) => error instanceof ApiError ? error.status >= 500 && failureCount < 1 : failureCount < 1
    }
  }
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timeout = setTimeout(() => setFontTimedOut(true), 3_500);
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError]);
  useEffect(() => { void trackEvent('app_open'); }, []);
  // A font download is cosmetic. If it fails or takes too long, render the
  // app with the platform sans-serif fallback instead of blocking navigation.
  if (!fontsLoaded && !fontError && !fontTimedOut) return <View style={styles.loading}><StatusBar style="light" /><Text style={styles.loadingText}>Preparando tu mesa…</Text></View>;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="register" options={{ presentation: 'modal', gestureEnabled: true }} />
            <Stack.Screen name="auth" options={{ presentation: 'modal', gestureEnabled: true }} />
            <Stack.Screen name="photo-upload" options={{ presentation: 'modal', gestureEnabled: true }} />
            <Stack.Screen name="place/[id]" />
          </Stack>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 13 }
});
