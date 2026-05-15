import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Switch, ScrollView, FlatList, Image, SafeAreaView, Modal,
} from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import * as Updates from 'expo-updates'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { StatusBar } from 'expo-status-bar'
import { WebView } from 'react-native-webview'
import { Audio } from 'expo-av'

const SOUND_COUNT = 10
const MAX_ACCOUNTS = 10 // 프리미엄 계정은 추후 무제한으로 확장 예정

const SOUND_FILES: Record<string, any> = {
  '1':  require('./assets/sounds/sound_1.mp3'),
  '2':  require('./assets/sounds/sound_2.mp3'),
  '3':  require('./assets/sounds/sound_3.mp3'),
  '4':  require('./assets/sounds/sound_4.mp3'),
  '5':  require('./assets/sounds/sound_5.mp3'),
  '6':  require('./assets/sounds/sound_6.mp3'),
  '7':  require('./assets/sounds/sound_7.mp3'),
  '8':  require('./assets/sounds/sound_8.mp3'),
  '9':  require('./assets/sounds/sound_9.mp3'),
  '10': require('./assets/sounds/sound_10.mp3'),
}

async function setupNotificationChannels() {
  await Notifications.setNotificationChannelAsync('sound-default', {
    name: '기본 알림음',
    importance: Notifications.AndroidImportance.HIGH,
    sound: true,
    vibrationPattern: [0, 250, 250, 250],
  })
  for (let i = 1; i <= SOUND_COUNT; i++) {
    await Notifications.setNotificationChannelAsync(`sound-${i}`, {
      name: `알림음 ${i}`,
      importance: Notifications.AndroidImportance.HIGH,
      sound: `sound_${i}.mp3`,
      vibrationPattern: [0, 250, 250, 250],
    })
  }
}

const NOTIFICATION_TYPES = [
  { key: 'node_offline',     label: '노드 오프라인',  desc: 'PC 꺼짐 / 앱 종료 감지' },
  { key: 'node_online',      label: '노드 재접속',    desc: '노드 복구 시' },
  { key: 'process_critical', label: '프로세스 이상',  desc: '프로세스 중단 감지' },
  { key: 'process_warning',  label: '프로세스 경고',  desc: '프로세스 불안정' },
  { key: 'process_recovery', label: '프로세스 복구',  desc: '프로세스 정상화' },
  { key: 'port_critical',    label: '포트 이상',      desc: '포트 전체 차단' },
  { key: 'port_recovery',    label: '포트 복구',      desc: '포트 정상화' },
]

type Prefs = Record<string, boolean>
const DEFAULT_PREFS: Prefs = Object.fromEntries(NOTIFICATION_TYPES.map(t => [t.key, true]))
const API = 'https://pilink.vercel.app'

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

const RANK_MEDAL = ['#f59e0b', '#9ca3af', '#f97316', '#6b7280', '#6b7280']
const RANK_EMOJI = ['🥇', '🥈', '🥉']

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

interface Notice { id: string; title: string; nickname: string; created_at: string }
interface NodeEvent { id: string; pi_uid: string; event_type: string; severity: string; message: string; created_at: string }
interface RankEntry { rank: number; nickname: string; total_likes: number }

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444', warning: '#f59e0b', recovery: '#10b981', info: '#3b82f6',
}
const SEVERITY_LABEL: Record<string, string> = {
  critical: '위험', warning: '경고', recovery: '복구', info: '정보',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}

export default function App() {
  const [webUrl, setWebUrl]             = useState<string | null>(null)
  const [username, setUsername]         = useState('')
  const [registeredList, setRegisteredList] = useState<string[]>([])
  const [expoToken, setExpoToken]       = useState<string | null>(null)
  const [prefs, setPrefs]               = useState<Prefs>(DEFAULT_PREFS)
  const [sound, setSound]               = useState('default')
  const [showSoundModal, setShowSoundModal]       = useState(false)
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showAccountModal, setShowAccountModal]   = useState(false)
  const [registerStep, setRegisterStep]           = useState<1 | 2>(1)
  const [pairCode, setPairCode]                   = useState('')
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [notices, setNotices]           = useState<Notice[]>([])
  const [rankings, setRankings]         = useState<RankEntry[]>([])
  const [weekLabel, setWeekLabel]       = useState('')
  const [recentEvents, setRecentEvents] = useState<NodeEvent[]>([])
  const [showEventModal, setShowEventModal] = useState(false)

  useEffect(() => {
    setupNotificationChannels()

    Promise.all([
      AsyncStorage.getItem('registered_uids'),
      AsyncStorage.getItem('registered_uid'), // 구버전 마이그레이션
      AsyncStorage.getItem('notification_prefs'),
      AsyncStorage.getItem('notification_sound'),
    ]).then(([uids, oldUid, savedPrefs, savedSound]) => {
      if (uids) {
        setRegisteredList(JSON.parse(uids))
      } else if (oldUid) {
        const migrated = [oldUid]
        setRegisteredList(migrated)
        AsyncStorage.setItem('registered_uids', JSON.stringify(migrated))
        AsyncStorage.removeItem('registered_uid')
      }
      if (savedPrefs) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(savedPrefs) })
      if (savedSound) setSound(savedSound)
      setLoading(false)
    })

    if (!__DEV__) {
      Updates.checkForUpdateAsync().then(({ isAvailable }) => {
        if (isAvailable) {
          Updates.fetchUpdateAsync().then(() => {
            Alert.alert('업데이트 완료', '새 버전이 적용됐습니다. 앱을 재시작합니다.',
              [{ text: '확인', onPress: () => Updates.reloadAsync() }])
          }).catch(() => {})
        }
      }).catch(() => {})
    }

    fetch(`${API}/api/app-version`)
      .then(r => r.json())
      .then(({ minimum, apk_url }) => {
        const current = Constants.expoConfig?.version ?? '0.0.0'
        if (compareVersion(current, minimum) < 0) {
          Alert.alert(
            '새 버전 출시',
            'LinkPiMonitor 새 버전이 출시됐습니다.\n아래 링크에서 최신 APK를 다운받아 설치해주세요.',
            [
              { text: '나중에' },
              { text: '다운로드', onPress: () => require('react-native').Linking.openURL(apk_url) },
            ]
          )
        }
      })
      .catch(() => {})

    fetch(`${API}/api/posts?type=notice&limit=5`)
      .then(r => r.json())
      .then(d => setNotices(d.data ?? []))
      .catch(() => {})

    fetch(`${API}/api/rankings`)
      .then(r => r.json())
      .then(d => {
        setRankings((d.data ?? []).slice(0, 5))
        if (d.weekStart) {
          const start = new Date(d.weekStart)
          const end   = new Date(start.getTime() + 6 * 86400000)
          const fmt   = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
          setWeekLabel(`${fmt(start)} ~ ${fmt(end)}`)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (registeredList.length === 0) { setRecentEvents([]); return }
    Promise.all(
      registeredList.map(uid =>
        fetch(`${API}/api/node-events?pi_uid=${encodeURIComponent(uid)}&limit=100&offset=0`)
          .then(r => r.json())
          .then(d => d.data ?? [])
          .catch(() => [])
      )
    ).then(results => {
      const merged = (results.flat() as NodeEvent[])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 100)
      setRecentEvents(merged)
    })
  }, [registeredList])

  const savePrefs = useCallback(async (newPrefs: Prefs, newSound?: string) => {
    await AsyncStorage.setItem('notification_prefs', JSON.stringify(newPrefs))
    const merged = { ...newPrefs, sound: newSound ?? sound }
    await Promise.all(
      registeredList.map(uid =>
        fetch(`${API}/api/expo-push/prefs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pi_uid: uid, prefs: merged }),
        }).catch(() => {})
      )
    )
  }, [sound, registeredList])

  const togglePref = (key: string) => {
    if (registeredList.length === 0) return
    const newPrefs = { ...prefs, [key]: !prefs[key] }
    setPrefs(newPrefs)
    savePrefs(newPrefs)
  }

  const getOrFetchToken = async (): Promise<string | null> => {
    if (expoToken) return expoToken
    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') {
      Alert.alert('권한 필요', '설정에서 알림 권한을 허용해주세요.')
      return null
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
    const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    setExpoToken(tokenData.data)
    return tokenData.data
  }

  const goToStep2 = () => {
    const uid = username.trim()
    if (!uid) { Alert.alert('오류', 'Pi 사용자명을 입력해주세요.'); return }
    if (registeredList.includes(uid)) { Alert.alert('이미 등록됨', `@${uid}는 이미 등록된 계정입니다.`); return }
    if (registeredList.length >= MAX_ACCOUNTS) {
      Alert.alert('등록 한도 초과', `최대 ${MAX_ACCOUNTS}개까지 등록할 수 있습니다.`)
      return
    }
    setRegisterStep(2)
  }

  const register = async () => {
    const uid = username.trim()
    const code = pairCode.trim()
    if (!code || code.length !== 6) { Alert.alert('오류', '6자리 연동 코드를 입력해주세요.'); return }
    if (!Device.isDevice) { Alert.alert('오류', '실제 기기에서만 사용 가능합니다.'); return }
    setSaving(true)
    try {
      // 연동 코드 검증
      const verifyRes = await fetch(`${API}/api/guardian-pair/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pi_uid: uid, code }),
      })
      if (!verifyRes.ok) {
        const { error } = await verifyRes.json()
        Alert.alert('연동 실패', error ?? '코드 검증에 실패했습니다.')
        setSaving(false)
        return
      }
      // 검증 성공 → 토큰 등록
      const token = await getOrFetchToken()
      if (!token) { setSaving(false); return }
      const res = await fetch(`${API}/api/expo-push/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pi_uid: uid, token, prefs: { ...prefs, sound } }),
      })
      if (!res.ok) throw new Error()
      const newList = [...registeredList, uid]
      await AsyncStorage.setItem('registered_uids', JSON.stringify(newList))
      setRegisteredList(newList)
      setUsername('')
      setPairCode('')
      setRegisterStep(1)
    } catch {
      Alert.alert('오류', '등록에 실패했습니다. 다시 시도해주세요.')
    }
    setSaving(false)
  }

  const unregister = async (uid: string) => {
    if (expoToken) {
      await fetch(`${API}/api/expo-push/register`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pi_uid: uid, token: expoToken }),
      }).catch(() => {})
    }
    const newList = registeredList.filter(u => u !== uid)
    await AsyncStorage.setItem('registered_uids', JSON.stringify(newList))
    setRegisteredList(newList)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <StatusBar style="auto" />
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" backgroundColor="#7c3aed" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <Image source={require('./assets/icon.png')} style={styles.headerIcon} />
          <Text style={styles.logoText}>LinkPi</Text>
          <Text style={styles.logoSub}>파이 노드 운영자 커뮤니티</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>🔔 노드 알림 계정</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {registeredList.length > 0 && (
                <TouchableOpacity style={styles.outlineBtn} onPress={() => setShowAccountModal(true)}>
                  <Text style={styles.outlineBtnText}>등록된 계정 {registeredList.length}개</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowRegisterModal(true)}>
                <Text style={styles.addBtnText}>{registeredList.length === 0 ? '계정 등록' : '+ 추가'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {registeredList.length === 0 && (
            <Text style={styles.emptyHint}>등록된 계정이 없습니다.{'\n'}계정 등록 버튼을 눌러 Pi 사용자명을 추가하세요.</Text>
          )}
        </View>

        {registeredList.length > 0 && (() => {
          const allOn = NOTIFICATION_TYPES.every(t => prefs[t.key] ?? true)
          const toggleAll = () => {
            const newVal = !allOn
            const newPrefs = Object.fromEntries(NOTIFICATION_TYPES.map(t => [t.key, newVal])) as Prefs
            setPrefs(newPrefs)
            savePrefs(newPrefs)
          }
          return (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>⚙️ 알림 설정</Text>
                <TouchableOpacity onPress={toggleAll} style={[styles.toggleAllBtn, allOn && styles.toggleAllBtnOn]}>
                  <Text style={[styles.toggleAllBtnText, allOn && styles.toggleAllBtnTextOn]}>
                    {allOn ? '전체 끄기' : '전체 켜기'}
                  </Text>
                </TouchableOpacity>
              </View>
              {NOTIFICATION_TYPES.map((type, i) => (
                <View key={type.key} style={[styles.row, i < NOTIFICATION_TYPES.length - 1 && styles.rowBorder]}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{type.label}</Text>
                    <Text style={styles.rowDesc}>{type.desc}</Text>
                  </View>
                  <Switch
                    value={prefs[type.key] ?? true}
                    onValueChange={() => togglePref(type.key)}
                    trackColor={{ false: '#d1d5db', true: '#a78bfa' }}
                    thumbColor={prefs[type.key] ? '#7c3aed' : '#f4f3f4'}
                  />
                </View>
              ))}
            </View>
          )
        })()}

        {registeredList.length > 0 && (
          <TouchableOpacity style={styles.card} onPress={() => setShowSoundModal(true)} activeOpacity={0.7}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>🔔 알림음 선택</Text>
              <Text style={styles.changeBtnText}>변경 ›</Text>
            </View>
            <Text style={styles.currentSoundText}>
              현재: {sound === 'default' ? '기본 알림음 (시스템)' : `알림음 ${sound}`}
            </Text>
          </TouchableOpacity>
        )}

        {registeredList.length > 0 && recentEvents.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>⚠️ 최근 노드 알림</Text>
              <TouchableOpacity onPress={() => setShowEventModal(true)}>
                <Text style={styles.changeBtnText}>전체 {recentEvents.length}개 보기 ›</Text>
              </TouchableOpacity>
            </View>
            {recentEvents.slice(0, 3).map((e, i) => (
              <View key={e.id} style={[styles.eventRow, i < Math.min(recentEvents.length, 3) - 1 && styles.rowBorder]}>
                <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLOR[e.severity] ?? '#9ca3af' }]}>
                  <Text style={styles.severityText}>{SEVERITY_LABEL[e.severity] ?? e.severity}</Text>
                </View>
                <View style={styles.eventContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                    <Text style={styles.eventNickname}>@{e.pi_uid}</Text>
                    <Text style={styles.eventTime}>{formatDateTime(e.created_at)}</Text>
                  </View>
                  <Text style={styles.eventMessage} numberOfLines={1}>{e.message}</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.piLinkBanner} onPress={() => setWebUrl(API)}>
              <Text style={styles.piLinkBannerText}>📊 가동률 · 전체 이슈 내역은 파이브라우저 LinkPi에서 확인 →</Text>
            </TouchableOpacity>
          </View>
        )}

        {notices.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📢 공지사항</Text>
            {notices.map((notice, i) => (
              <TouchableOpacity key={notice.id} style={[styles.noticeRow, i < notices.length - 1 && styles.rowBorder]} onPress={() => setWebUrl(`${API}`)}>
                <Text style={styles.noticeTitle} numberOfLines={2}>{notice.title}</Text>
                <Text style={styles.noticeMeta}>@{notice.nickname} · {timeAgo(notice.created_at)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔗 LinkPi 바로가기</Text>
          <View style={styles.quickNavRow}>
            {[
              { label: '💬 커뮤니티', url: `${API}` },
              { label: '❓ QnA',      url: `${API}` },
              { label: '🏆 랭킹확인', url: `${API}` },
            ].map(item => (
              <TouchableOpacity key={item.label} style={styles.quickNavBtn} onPress={() => setWebUrl(item.url)}>
                <Text style={styles.quickNavBtnText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ height: 8 }} />
      </ScrollView>

      <Modal visible={showAccountModal} animationType="slide" transparent onRequestClose={() => setShowAccountModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>등록된 계정</Text>
              <TouchableOpacity onPress={() => setShowAccountModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={registeredList}
              keyExtractor={uid => uid}
              renderItem={({ item: uid, index: i }) => (
                <View style={[styles.soundItem, i % 2 === 0 ? {} : { backgroundColor: '#fafafa' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.soundItemText, { fontWeight: '600' }]}>@{uid}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.previewBtn, { backgroundColor: '#fee2e2' }]}
                    onPress={() => Alert.alert('등록 해제', `@${uid} 알림 수신을 해제할까요?`, [
                      { text: '취소', style: 'cancel' },
                      { text: '해제', style: 'destructive', onPress: () => unregister(uid) },
                    ])}
                  >
                    <Text style={[styles.previewBtnText, { color: '#ef4444' }]}>해제</Text>
                  </TouchableOpacity>
                </View>
              )}
              ListFooterComponent={
                <View>
                  <Text style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                    {registeredList.length}/{MAX_ACCOUNTS}개 등록됨
                  </Text>
                  <TouchableOpacity
                    style={{ margin: 16, backgroundColor: '#7c3aed', borderRadius: 12, padding: 14, alignItems: 'center', opacity: registeredList.length >= MAX_ACCOUNTS ? 0.4 : 1 }}
                    onPress={() => { if (registeredList.length < MAX_ACCOUNTS) { setShowAccountModal(false); setShowRegisterModal(true) } else { Alert.alert('등록 한도 초과', `최대 ${MAX_ACCOUNTS}개까지 등록할 수 있습니다.`) } }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>+ 계정 추가</Text>
                  </TouchableOpacity>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      <Modal visible={showRegisterModal} animationType="slide" transparent onRequestClose={() => { setShowRegisterModal(false); setUsername(''); setPairCode(''); setRegisterStep(1) }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { padding: 20 }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => { if (registerStep === 2) { setRegisterStep(1); setPairCode('') } }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ opacity: registerStep === 2 ? 1 : 0 }}
              >
                <Text style={{ fontSize: 18, color: '#7c3aed' }}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {registerStep === 1 ? '알림 계정 등록 (1/2)' : '연동 코드 입력 (2/2)'}
              </Text>
              <TouchableOpacity onPress={() => { setShowRegisterModal(false); setUsername(''); setPairCode(''); setRegisterStep(1) }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {registerStep === 1 ? (
              <>
                <Text style={styles.inputHint}>파이 앱 프로필의 @뒤 영문 아이디를 입력하세요</Text>
                <TextInput
                  style={styles.input}
                  placeholder="예: username"
                  placeholderTextColor="#9ca3af"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
                <TouchableOpacity style={styles.button} onPress={goToStep2}>
                  <Text style={styles.buttonText}>다음 →</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.pairGuideBox}>
                  <Text style={styles.pairGuideTitle}>PC에서 연동 코드 받기</Text>
                  <Text style={styles.pairGuideStep}>1. PC의 NodeGuardian 트레이 아이콘 우클릭</Text>
                  <Text style={styles.pairGuideStep}>2. [📱 앱 연동 코드] 클릭</Text>
                  <Text style={styles.pairGuideStep}>3. 팝업에 표시된 6자리 코드를 아래에 입력</Text>
                </View>
                <TextInput
                  style={[styles.input, { fontSize: 24, textAlign: 'center', letterSpacing: 8, fontWeight: '700' }]}
                  placeholder="000000"
                  placeholderTextColor="#d1d5db"
                  value={pairCode}
                  onChangeText={t => setPairCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <TouchableOpacity
                  style={[styles.button, saving && { opacity: 0.6 }]}
                  onPress={async () => { await register(); }}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>등록 완료</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showSoundModal} animationType="slide" transparent onRequestClose={() => setShowSoundModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>알림음 선택</Text>
              <TouchableOpacity onPress={() => setShowSoundModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {(['default', ...Array.from({ length: SOUND_COUNT }, (_, i) => String(i + 1))]).map(s => (
                <View key={s} style={[styles.soundItem, sound === s && styles.soundItemActive]}>
                  <TouchableOpacity
                    style={styles.soundItemLabel}
                    onPress={() => {
                      setSound(s)
                      AsyncStorage.setItem('notification_sound', s)
                      savePrefs(prefs, s)
                    }}
                  >
                    <Text style={[styles.soundItemText, sound === s && { color: '#7c3aed', fontWeight: '700' }]}>
                      {s === 'default' ? '기본 알림음 (시스템)' : `알림음 ${s}`}
                    </Text>
                    {sound === s && <Text style={styles.soundItemCheck}>✓</Text>}
                  </TouchableOpacity>
                  {s !== 'default' && (
                    <TouchableOpacity
                      style={styles.previewBtn}
                      onPress={async () => {
                        if (!SOUND_FILES[s]) return
                        try {
                          const { sound: audioObj } = await Audio.Sound.createAsync(SOUND_FILES[s])
                          await audioObj.playAsync()
                          audioObj.setOnPlaybackStatusUpdate(status => {
                            if ('didJustFinish' in status && status.didJustFinish) audioObj.unloadAsync()
                          })
                        } catch {}
                      }}
                    >
                      <Text style={styles.previewBtnText}>▶ 미리듣기</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showEventModal} animationType="slide" transparent onRequestClose={() => setShowEventModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>노드 알림 내역 ({recentEvents.length}개)</Text>
              <TouchableOpacity onPress={() => setShowEventModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={recentEvents}
              keyExtractor={e => e.id}
              renderItem={({ item: e, index: i }) => (
                <View style={[styles.eventRow, { paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }]}>
                  <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLOR[e.severity] ?? '#9ca3af' }]}>
                    <Text style={styles.severityText}>{SEVERITY_LABEL[e.severity] ?? e.severity}</Text>
                  </View>
                  <View style={styles.eventContent}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                      <Text style={styles.eventNickname}>@{e.pi_uid}</Text>
                      <Text style={styles.eventTime}>{formatDateTime(e.created_at)}</Text>
                    </View>
                    <Text style={styles.eventMessage} numberOfLines={2}>{e.message}</Text>
                  </View>
                </View>
              )}
              ListFooterComponent={<View style={{ height: 24 }} />}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={!!webUrl} animationType="slide" onRequestClose={() => setWebUrl(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#7c3aed' }}>
          <View style={styles.webHeader}>
            <Text style={styles.webHeaderTitle}>LinkPi</Text>
            <TouchableOpacity onPress={() => setWebUrl(null)} style={styles.webCloseBtn}>
              <Text style={styles.webCloseText}>✕ 닫기</Text>
            </TouchableOpacity>
          </View>
          {webUrl && <WebView source={{ uri: webUrl }} style={{ flex: 1 }} />}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root:              { flex: 1, backgroundColor: '#f5f3ff' },
  center:            { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f3ff' },
  scroll:            { padding: 16, paddingTop: 0 },
  header:            { backgroundColor: '#7c3aed', marginHorizontal: -16, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24, alignItems: 'center', marginBottom: 16 },
  headerIcon:        { width: 56, height: 56, borderRadius: 14, marginBottom: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  logoText:          { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  logoSub:           { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  card:              { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#7c3aed', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  cardTitle:         { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 12 },
  cardTitleRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  weekLabel:         { fontSize: 11, color: '#9ca3af' },
  label:             { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4 },
  inputHint:         { fontSize: 12, color: '#6b7280', marginBottom: 8 },
  input:             { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 14, color: '#111827' },
  button:            { backgroundColor: '#7c3aed', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText:        { color: '#fff', fontWeight: '700', fontSize: 15 },
  successText:       { fontSize: 17, fontWeight: 'bold', color: '#059669', marginBottom: 2 },
  successSub:        { fontSize: 14, color: '#7c3aed', fontWeight: '600', marginBottom: 12 },
  outlineButton:     { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 11, alignItems: 'center' },
  outlineButtonText: { color: '#6b7280', fontSize: 14 },
  row:               { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowBorder:         { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  rowText:           { flex: 1 },
  rowLabel:          { fontSize: 14, fontWeight: '500', color: '#111827' },
  rowDesc:           { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  noticeRow:         { paddingVertical: 10 },
  noticeTitle:       { fontSize: 14, fontWeight: '500', color: '#111827', lineHeight: 20 },
  noticeMeta:        { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  rankRow:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  rankBadge:         { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankBadgeText:     { fontSize: 15, fontWeight: '700' },
  rankNickname:      { flex: 1, fontSize: 14, fontWeight: '500', color: '#111827' },
  rankLikes:         { backgroundColor: '#fef2f2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  rankLikesText:     { fontSize: 12, color: '#ef4444', fontWeight: '600' },
  webHeader:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#7c3aed' },
  webHeaderTitle:    { fontSize: 18, fontWeight: '900', color: '#fff' },
  webCloseBtn:       { paddingHorizontal: 10, paddingVertical: 6 },
  webCloseText:      { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  addBtn:            { backgroundColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  addBtnText:        { color: '#fff', fontSize: 13, fontWeight: '700' },
  outlineBtn:        { borderWidth: 1, borderColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  outlineBtnText:    { color: '#7c3aed', fontSize: 12, fontWeight: '600' },
  emptyHint:         { fontSize: 13, color: '#9ca3af', lineHeight: 20 },
  eventNickname:     { fontSize: 11, color: '#7c3aed', fontWeight: '700' },
  toggleAllBtn:      { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  toggleAllBtnOn:    { borderColor: '#ef4444' },
  toggleAllBtnText:  { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  toggleAllBtnTextOn:{ color: '#ef4444' },
  quickNavRow:       { flexDirection: 'row', gap: 8 },
  quickNavBtn:       { flex: 1, backgroundColor: '#f5f3ff', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  quickNavBtnText:   { fontSize: 13, color: '#7c3aed', fontWeight: '600' },
  changeBtnText:     { fontSize: 13, color: '#7c3aed', fontWeight: '600' },
  currentSoundText:  { fontSize: 13, color: '#6b7280' },
  eventRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 10 },
  severityBadge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, minWidth: 36, alignItems: 'center' },
  severityText:      { fontSize: 11, color: '#fff', fontWeight: '700' },
  eventContent:      { flex: 1 },
  eventMessage:      { fontSize: 13, color: '#111827' },
  eventTime:         { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  piLinkBanner:      { marginTop: 10, backgroundColor: '#f5f3ff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  piLinkBannerText:  { fontSize: 12, color: '#7c3aed', fontWeight: '600' },
  modalOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet:        { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' },
  modalHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  modalTitle:        { fontSize: 16, fontWeight: '700', color: '#111827' },
  modalClose:        { fontSize: 18, color: '#9ca3af', fontWeight: '400' },
  pairGuideBox:      { backgroundColor: '#f5f3ff', borderRadius: 12, padding: 14, marginBottom: 14 },
  pairGuideTitle:    { fontSize: 13, fontWeight: '700', color: '#7c3aed', marginBottom: 8 },
  pairGuideStep:     { fontSize: 12, color: '#374151', lineHeight: 22 },
  soundItem:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  soundItemActive:   { backgroundColor: '#f5f3ff' },
  soundItemLabel:    { flex: 1, flexDirection: 'row', alignItems: 'center' },
  soundItemText:     { fontSize: 15, color: '#374151', flex: 1 },
  soundItemCheck:    { fontSize: 16, color: '#7c3aed', marginRight: 8 },
  previewBtn:        { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#ede9fe', borderRadius: 8 },
  previewBtnText:    { fontSize: 12, color: '#7c3aed', fontWeight: '600' },
})
