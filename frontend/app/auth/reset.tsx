import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../../src/services/api';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = useMemo(() => {
    const t = params.token;
    return Array.isArray(t) ? t[0] : t;
  }, [params.token]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setErrorText(null);
    setDone(false);
    if (!token) {
      setErrorText('Token eksik.');
      return;
    }
    if (!password || password.length < 6) {
      setErrorText('Şifre en az 6 karakter olmalı.');
      return;
    }
    if (password !== confirm) {
      setErrorText('Şifreler eşleşmiyor.');
      return;
    }
    setLoading(true);
    try {
      await authAPI.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.replace('/auth/login'), 700);
    } catch {
      setErrorText('Şifre sıfırlama başarısız. Linkin süresi dolmuş olabilir.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Şifre sıfırla</Text>
        </View>

        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Yeni şifre"
            placeholderTextColor="#999"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setErrorText(null);
            }}
            secureTextEntry
            autoComplete="password-new"
            maxLength={200}
          />
        </View>

        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Şifre tekrar"
            placeholderTextColor="#999"
            value={confirm}
            onChangeText={(t) => {
              setConfirm(t);
              setErrorText(null);
            }}
            secureTextEntry
            autoComplete="password-new"
            maxLength={200}
          />
        </View>

        {done ? <Text style={styles.successText}>Şifre güncellendi. Yönlendiriliyor...</Text> : null}
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

        <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={submit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Şifreyi güncelle</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { flexGrow: 1, padding: 24, paddingTop: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#333' },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#333' },
  button: {
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  errorText: { color: '#c62828', fontSize: 14, marginTop: 6, textAlign: 'center' },
  successText: { color: '#2e7d32', fontSize: 14, marginTop: 6, textAlign: 'center' },
});

