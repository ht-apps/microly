import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { toggleCatalogPreference } from '../../features/preference/preference-state'
import {
  saveUserPreference,
  syncUserPreference,
} from '../../features/preference/preference-storage'
import { flushFullSync } from '../../features/sync/state-sync'

import './index.scss'

const catalogs = trainingContent.chapters.flatMap(
  (chapter) => chapter.catalog ? [chapter.catalog] : [],
)
const catalogIds = catalogs.map((catalog) => catalog.catalogId)

export default function PreferencesPage() {
  const [stored, setStored] = useState(() => syncUserPreference(catalogIds))
  const [selectedCatalogIds, setSelectedCatalogIds] = useState(
    stored.preference?.selectedCatalogIds ?? [],
  )
  const [storageWarning, setStorageWarning] = useState(
    stored.recoveredFromInvalid || stored.writeFailed,
  )

  const togglePreference = (catalogId: string) => {
    const result = toggleCatalogPreference(selectedCatalogIds, catalogId)
    if (result.limitReached) {
      Taro.showToast({ title: '最多选择 2 项重点能力', icon: 'none' })
      return
    }
    setSelectedCatalogIds(result.selectedCatalogIds)
  }

  const save = async () => {
    const result = saveUserPreference(
      selectedCatalogIds,
      stored.preference,
    )
    void flushFullSync()
    if (result.writeFailed) {
      setStorageWarning(true)
      return
    }
    setStored({
      preference: result.preference,
      recoveredFromInvalid: false,
      missing: false,
      writeFailed: false,
    })
    setStorageWarning(false)
    await Taro.showToast({ title: '学习偏好已保存', icon: 'success' })
  }

  return (
    <View className='preferences-page'>
      <View className='preferences-hero'>
        <Text className='preferences-eyebrow'>本机学习设置</Text>
        <Text className='preferences-title'>选择你的重点能力</Text>
        <Text className='preferences-body'>
          可选择 1～2 项，也可以清空。偏好只用于重点标记，不会跳过课程前置或重置进度。
        </Text>
      </View>

      {storageWarning && (
        <View className='preferences-notice'>部分偏好暂时无法保存，请稍后重试。</View>
      )}

      <View className='preferences-list'>
        {catalogs.map((catalog) => {
          const isSelected = selectedCatalogIds.includes(catalog.catalogId)
          return (
            <Button
              key={catalog.catalogId}
              className={`microly-button preferences-option ${isSelected ? 'preferences-option--selected' : ''}`}
              onClick={() => togglePreference(catalog.catalogId)}
            >
              <View className='preferences-option__check'>{isSelected ? '✓' : ''}</View>
              <View className='preferences-option__content'>
                <Text className='preferences-option__title'>{catalog.title}</Text>
                <Text className='preferences-option__body'>{catalog.description}</Text>
              </View>
            </Button>
          )
        })}
      </View>

      <Button className='microly-button preferences-primary-button' onClick={save}>
        保存学习偏好
      </Button>
      {selectedCatalogIds.length > 0 && (
        <Button
          className='microly-button preferences-text-button'
          onClick={() => setSelectedCatalogIds([])}
        >
          清空选择
        </Button>
      )}
    </View>
  )
}
