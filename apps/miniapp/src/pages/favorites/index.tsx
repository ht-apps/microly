import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { setSessionFavorite, syncFavoriteQueue } from '../../features/favorite/favorite-storage'
import { flushFullSync } from '../../features/sync/state-sync'
import type { ResolvedFavoriteItem } from '../../features/favorite/favorite-state'
import { transitionTraining } from '../../features/training/training-state'
import { trackTrainingStart } from '../../features/analytics/training-analytics'
import {
  clearTrainingProgress,
  readTrainingProgress,
  writeTrainingProgress,
} from '../../features/training/training-storage'

import './index.scss'

function readFavoritesSnapshot() {
  return syncFavoriteQueue(trainingContent.sessions)
}

export default function FavoritesPage() {
  const [snapshot, setSnapshot] = useState(readFavoritesSnapshot)
  const [storageWarning, setStorageWarning] = useState(snapshot.writeFailed)

  useDidShow(() => {
    const next = readFavoritesSnapshot()
    setSnapshot(next)
    if (next.writeFailed) setStorageWarning(true)
  })

  const remove = (entry: ResolvedFavoriteItem) => {
    const result = setSessionFavorite(
      trainingContent.sessions,
      entry.session,
      false,
    )
    void flushFullSync()
    if (result.writeFailed) {
      setStorageWarning(true)
      return
    }
    setSnapshot(readFavoritesSnapshot())
    Taro.showToast({ title: '已取消收藏', icon: 'none' })
  }

  const restart = async (entry: ResolvedFavoriteItem) => {
    const result = await Taro.showModal({
      title: '重新训练？',
      content: `“${entry.session.title}”的当前完成记录会被清除，收藏和复习计划不受影响。`,
      confirmText: '重新开始',
      confirmColor: '#5b5bd6',
    })
    if (!result.confirm) return

    const stored = readTrainingProgress(entry.session)
    clearTrainingProgress(entry.session)
    const reset = transitionTraining(stored.progress, entry.session, { type: 'RESET' })
    const started = transitionTraining(reset, entry.session, { type: 'START' })
    trackTrainingStart(entry.session, started, 'favorites')
    if (!writeTrainingProgress(started)) {
      setStorageWarning(true)
      return
    }
    await Taro.navigateTo({
      url: `/pages/training/index?sessionId=${entry.session.sessionId}&entry=favorites`,
    })
  }

  return (
    <View className='favorites-page'>
      <View className='favorites-hero'>
        <Text className='favorites-hero__eyebrow'>随时回看</Text>
        <Text className='favorites-hero__title'>收藏的表达原则</Text>
        <Text className='favorites-hero__body'>收藏只用于查阅，不会自动增加复习任务。</Text>
      </View>

      {(snapshot.recoveredFromInvalid || storageWarning) && (
        <View className='favorites-notice'>
          {storageWarning
            ? '收藏暂时无法完整保存，请保持页面开启。'
            : '部分收藏数据无法读取，已安全整理。'}
        </View>
      )}

      {snapshot.resolvedItems.length === 0 ? (
        <View className='favorites-empty'>
          <Text className='favorites-empty__icon'>☆</Text>
          <Text className='favorites-empty__title'>还没有收藏原则</Text>
          <Text className='favorites-empty__body'>训练到原则卡时，可以收藏值得反复查看的表达结构。</Text>
          <Button
            className='microly-button favorites-primary-button'
            onClick={() => Taro.switchTab({ url: '/pages/course/index' })}
          >
            去选择训练
          </Button>
        </View>
      ) : (
        <View className='favorites-list'>
          {snapshot.resolvedItems.map((entry) => (
            <View className='favorite-card' key={entry.item.favoriteId}>
              <View className='favorite-card__topline'>
                <Text className='favorite-card__session'>{entry.session.title}</Text>
                {entry.contentUpdated && (
                  <Text className='favorite-card__updated'>内容已更新</Text>
                )}
              </View>
              <Text className='favorite-card__title'>{entry.principleCard.title}</Text>
              <Text className='favorite-card__summary'>{entry.principleCard.summary}</Text>
              <View className='favorite-formula'>
                <Text className='favorite-formula__label'>表达结构</Text>
                <Text className='favorite-formula__value'>{entry.principleCard.formula}</Text>
              </View>
              <View className='favorite-example'>
                <Text className='favorite-example__label'>参考表达</Text>
                <Text className='favorite-example__value'>{entry.principleCard.example}</Text>
              </View>
              <View className='favorite-card__actions'>
                <Button
                  className='microly-button favorite-card__primary'
                  onClick={() => restart(entry)}
                >
                  重新训练
                </Button>
                <Button
                  className='microly-button favorite-card__secondary'
                  onClick={() => remove(entry)}
                >
                  取消收藏
                </Button>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
