import React, { useState, useCallback } from 'react';
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
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { API_BASE_URL } from '../../src/services/api';

function loginErrorMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } }; code?: string; message?: string };
  if (e?.response?.status === 401) {
    return 'E-posta veya şifre hatalı.';
  }
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0] && typeof (detail[0] as { msg?: string }).msg === 'string') {
    return (detail as { msg: string }[]).map((x) => x.msg).join(' ');
  }
  if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') {
    return `Bağlantı kurulamadı. API: ${API_BASE_URL}`;
  }
  return 'Giriş yapılamadı. Tekrar deneyin.';
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const { login } = useAuth();
  const router = useRouter();
  const { registered } = useLocalSearchParams<{ registered?: string }>();

  const handleLogin = async () => {
    setErrorText(null);
    if (!email || !password) {
      setErrorText('Lütfen e-posta ve şifrenizi girin.');
      return;
    }

    setLoading(true);
    try {
      await login(email.toLowerCase().trim(), password);
    } catch (err) {
      setErrorText(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onChangeEmail = useCallback((t: string) => {
    setEmail(t);
    setErrorText(null);
  }, []);
  const onChangePassword = useCallback((t: string) => {
    setPassword(t);
    setErrorText(null);
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Image
              source={require('../../assets/images/elden-logo.png')}
              style={styles.brandImage}
              resizeMode="contain"
              accessibilityLabel="Elden logosu"
            />
          </View>
          <Text style={styles.title}>Elden</Text>
          <Text style={styles.tagline}>İkinci el alım satım platformu</Text>
          <Text style={styles.subtitle}>Hesabınıza giriş yapın</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="E-posta"
              placeholderTextColor="#999"
              value={email}
              onChangeText={onChangeEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              maxLength={254}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Şifre"
              placeholderTextColor="#999"
              value={password}
              onChangeText={onChangePassword}
              secureTextEntry
              autoComplete="password"
              maxLength={200}
            />
          </View>

          <TouchableOpacity style={styles.forgotLink} onPress={() => router.push('/auth/forgot-password')}>
            <Text style={styles.forgotLinkText}>Şifremi unuttum</Text>
          </TouchableOpacity>

          {registered === '1' ? (
            <Text style={styles.successBanner}>Kayıt tamamlandı. Şimdi giriş yapabilirsiniz.</Text>
          ) : null}
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>Giriş Yap</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>veya</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.registerButton}
            onPress={() => router.push('/auth/register')}
          >
            <Text style={styles.registerButtonText}>Hesap Oluştur</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconContainer: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#fff5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    overflow: 'hidden',
  },
  brandImage: {
    width: 112,
    height: 112,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  tagline: {
    fontSize: 15,
    color: '#ff3b30',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: -6,
    marginBottom: 10,
  },
  forgotLinkText: {
    color: '#ff3b30',
    fontSize: 13,
    fontWeight: '600',
  },
  loginButton: {
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#666',
    fontSize: 14,
  },
  registerButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ff3b30',
  },
  registerButtonText: {
    color: '#ff3b30',
    fontSize: 18,
    fontWeight: '600',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  successBanner: {
    color: '#2e7d32',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
});
