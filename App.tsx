import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { StatusBar } from 'expo-status-bar'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

const API = 'https://pilink.vercel.app'

export default function App() {
  const [username, setUsername] = useState('')
  const [registered, setRegistered] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('registered_uid').then(uid => {
      setRegistered(uid)
      setLoading(false)
    })
  }, [])

  const register = async () => {
    if (!username.trim()) {
      Alert.alert('오류', 'Pi 사용자명을 입력해주세요.')
      return
    }
    if (!Device.isDevice) {
      Alert.alert('오류', '실제 기기에서만 사용 가능합니다.')
      return
    }

    setSaving(true)

    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') {
      Alert.alert('권한 필요', '설정에서 알림 권한을 허용해주세요.')
      setSaving(false)
      return
    }

    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
      const tokenData = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      )

      const res = await fetch(`${API}/api/expo-push/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pi_uid: username.trim(), token: tokenData.data }),
      })

      if (!res.ok) throw new Error('서버 오류')

      await AsyncStorage.setItem('registered_uid', username.trim())
      setRegistered(username.trim())
    } catch {
      Alert.alert('오류', '등록에 실패했습니다. 다시 시도해주세요.')
    }

    setSaving(false)
  }

  const unregister = async () => {
    await AsyncStorage.removeItem('registered_uid')
    setRegistered(null)
    setUsername('')
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <StatusBar style="auto" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.emoji}>🔔</Text>
      <Text style={styles.title}>PiLink 알림</Text>
      <Text style={styles.subtitle}>노드 이상 알림을 실시간으로 받으세요</Text>

      {registered ? (
        <View style={styles.card}>
          <Text style={styles.successText}>✅ 알림 등록 완료</Text>
          <Text style={styles.successSub}>@{registered}</Text>
          <Text style={styles.desc}>노드 이상 발생 시 즉시 알림이 옵니다</Text>
          <TouchableOpacity style={styles.outlineButton} onPress={unregister}>
            <Text style={styles.outlineButtonText}>등록 해제</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Pi 사용자명</Text>
          <TextInput
            style={styles.input}
            placeholder="예: doosanprince"
            placeholderTextColor="#9ca3af"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.button, saving && styles.buttonDisabled]}
            onPress={register}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>알림 등록</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#f5f3ff',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  emoji: { fontSize: 52, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#7c3aed', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 32, textAlign: 'center' },
  card: {
    width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    padding: 12, fontSize: 15, marginBottom: 16, color: '#111827',
  },
  button: {
    backgroundColor: '#7c3aed', borderRadius: 10,
    padding: 14, alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  successText: { fontSize: 18, fontWeight: 'bold', color: '#059669', marginBottom: 4 },
  successSub: { fontSize: 15, color: '#7c3aed', fontWeight: '600', marginBottom: 8 },
  desc: { fontSize: 13, color: '#6b7280', marginBottom: 16 },
  outlineButton: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    padding: 12, alignItems: 'center',
  },
  outlineButtonText: { color: '#6b7280', fontSize: 14 },
})
