import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth';
import { ApiError, trackEvent } from '@/lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A missing place/list should resolve immediately; retry only network
      // failures and server-side errors that may recover on the next attempt.
      retry: (failureCount, error) => error instanceof ApiError ? error.status >= 500 && failureCount < 1 : failureCount < 1
    }
  }
});

export default function RootLayout() {
  useEffect(() => { void trackEvent('app_open'); }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="register" options={{ presentation: 'modal', gestureEnabled: true }} />
            <Stack.Screen name="auth" options={{ presentation: 'modal', gestureEnabled: true }} />
            <Stack.Screen name="place/[id]" />
          </Stack>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
