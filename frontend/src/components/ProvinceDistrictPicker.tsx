import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  ActivityIndicator,
  Pressable,
  Keyboard,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchProvinces, fetchDistrictsForProvince, ProvinceRow, DistrictRow } from '../services/turkiyeApi';

const SCREEN_H = Dimensions.get('window').height;
const MODAL_LIST_MIN_H = Math.round(SCREEN_H * 0.45);

function norm(s: string) {
  return s.toLocaleLowerCase('tr-TR').trim();
}

type Props = {
  city: string;
  district: string;
  onCityChange: (v: string) => void;
  onDistrictChange: (v: string) => void;
  /** Arama ekranı için daha sıkı yerleşim */
  compact?: boolean;
};

export function ProvinceDistrictPicker({
  city,
  district,
  onCityChange,
  onDistrictChange,
  compact,
}: Props) {
  const [provinces, setProvinces] = useState<ProvinceRow[]>([]);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [provinceId, setProvinceId] = useState<number | null>(null);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [provModal, setProvModal] = useState(false);
  const [distModal, setDistModal] = useState(false);
  const [provQuery, setProvQuery] = useState('');
  const [distQuery, setDistQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchProvinces();
        if (!cancelled) setProvinces(p);
      } catch {
        if (!cancelled) setProvinces([]);
      } finally {
        if (!cancelled) setLoadingProvinces(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!city || provinces.length === 0) {
      if (!city) setProvinceId(null);
      return;
    }
    const p = provinces.find((x) => x.name === city);
    setProvinceId(p?.id ?? null);
  }, [city, provinces]);

  useEffect(() => {
    if (provinceId == null) {
      setDistricts([]);
      return;
    }
    let cancelled = false;
    setLoadingDistricts(true);
    (async () => {
      try {
        const d = await fetchDistrictsForProvince(provinceId);
        if (!cancelled) setDistricts(d);
      } catch {
        if (!cancelled) setDistricts([]);
      } finally {
        if (!cancelled) setLoadingDistricts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provinceId]);

  const selectProvince = (p: ProvinceRow) => {
    setProvinceId(p.id);
    onCityChange(p.name);
    onDistrictChange('');
    setProvModal(false);
    setProvQuery('');
    Keyboard.dismiss();
  };

  const selectDistrict = (d: DistrictRow) => {
    onDistrictChange(d.name);
    setDistModal(false);
    setDistQuery('');
    Keyboard.dismiss();
  };

  const filteredProvinces = useMemo(() => {
    const q = norm(provQuery);
    if (!q) return provinces;
    return provinces.filter((p) => norm(p.name).includes(q));
  }, [provinces, provQuery]);

  const filteredDistricts = useMemo(() => {
    const q = norm(distQuery);
    if (!q) return districts;
    return districts.filter((d) => norm(d.name).includes(q));
  }, [districts, distQuery]);

  const labelStyle = compact ? styles.labelCompact : styles.label;
  const rowStyle = compact ? styles.rowCompact : styles.row;

  return (
    <View style={styles.wrapper}>
      <View style={rowStyle}>
        <View style={styles.field}>
          <Text style={labelStyle}>İl</Text>
          <TouchableOpacity
            style={[styles.selector, compact && styles.selectorCompact]}
            onPress={() => {
              Keyboard.dismiss();
              setProvModal(true);
            }}
            disabled={loadingProvinces}
            activeOpacity={0.7}
          >
            {loadingProvinces ? (
              <ActivityIndicator size="small" color="#ff3b30" />
            ) : (
              <>
                <Text style={[styles.selectorText, !city && styles.placeholder]} numberOfLines={1}>
                  {city || 'İl seçin'}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#666" />
              </>
            )}
          </TouchableOpacity>
        </View>
        <View style={styles.field}>
          <Text style={labelStyle}>İlçe</Text>
          <TouchableOpacity
            style={[
              styles.selector,
              compact && styles.selectorCompact,
              !provinceId && styles.selectorDisabled,
            ]}
            onPress={() => {
              if (!provinceId) return;
              Keyboard.dismiss();
              setDistModal(true);
            }}
            disabled={!provinceId || loadingDistricts}
            activeOpacity={0.7}
          >
            {loadingDistricts ? (
              <ActivityIndicator size="small" color="#999" />
            ) : (
              <>
                <Text style={[styles.selectorText, !district && styles.placeholder]} numberOfLines={1}>
                  {district || 'İlçe seçin'}
                </Text>
                <Ionicons name="chevron-down" size={20} color={provinceId ? '#666' : '#ccc'} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={provModal} animationType="slide" transparent onRequestClose={() => setProvModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setProvModal(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>İl seçin</Text>
              <TouchableOpacity onPress={() => setProvModal(false)} hitSlop={12}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="İl ara..."
              placeholderTextColor="#999"
              value={provQuery}
              onChangeText={setProvQuery}
            />
            <View style={styles.modalListWrap}>
              <FlatList
                data={filteredProvinces}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                style={styles.modalList}
                contentContainerStyle={styles.modalListContent}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.listItem} onPress={() => selectProvince(item)}>
                    <Text style={styles.listItemText}>{item.name}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={distModal} animationType="slide" transparent onRequestClose={() => setDistModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDistModal(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>İlçe seçin</Text>
              <TouchableOpacity onPress={() => setDistModal(false)} hitSlop={12}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="İlçe ara..."
              placeholderTextColor="#999"
              value={distQuery}
              onChangeText={setDistQuery}
            />
            <View style={styles.modalListWrap}>
              <FlatList
                data={filteredDistricts}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                style={styles.modalList}
                contentContainerStyle={styles.modalListContent}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.listItem} onPress={() => selectDistrict(item)}>
                    <Text style={styles.listItemText}>{item.name}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 4,
  },
  rowCompact: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  field: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  labelCompact: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  selectorCompact: {
    paddingVertical: 12,
    minHeight: 48,
  },
  selectorDisabled: {
    opacity: 0.55,
  },
  selectorText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginRight: 8,
  },
  placeholder: {
    color: '#999',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '88%',
    paddingBottom: 24,
    overflow: 'hidden',
  },
  modalListWrap: {
    minHeight: MODAL_LIST_MIN_H,
    maxHeight: Math.round(SCREEN_H * 0.55),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  searchInput: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
  },
  modalList: {
    flex: 1,
  },
  modalListContent: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  listItem: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  listItemText: {
    fontSize: 16,
    color: '#333',
  },
});
