import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';

const URL_DIVISOR = 'https://preco3d.pages.dev';

export default function Divisor() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0f14' }}>
      <WebView
        source={{ uri: URL_DIVISOR }}
        style={{ flex: 1, backgroundColor: '#0b0f14' }}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        setSupportMultipleWindows={false}
        startInLoadingState
        renderLoading={() => (
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0f14' }}>
            <ActivityIndicator size="large" color="#f97316" />
          </View>
        )}
      />
    </View>
  );
}
