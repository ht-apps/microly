import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { formatReviewDate } from '../../features/review/review-state'
import { readProfileSnapshot } from '../../features/profile/profile-snapshot'

import './index.scss'

export default function ProfilePage() {
  const [snapshot, setSnapshot] = useState(readProfileSnapshot)

  useDidShow(() => setSnapshot(readProfileSnapshot()))

  const { summary } = snapshot
  const openCourse = () => Taro.switchTab({ url: '/pages/course/index' })
  const openReviews = () => Taro.navigateTo({ url: '/pages/review/index' })
  const openFavorites = () => Taro.navigateTo({ url: '/pages/favorites/index' })
  const openPreferences = () => Taro.navigateTo({ url: '/pages/preferences/index' })

  return (
    <View className='profile-page'>
      <View className='profile-hero'>
        <Text className='profile-hero__eyebrow'>我的学习</Text>
        <Text className='profile-hero__title'>本机学习记录</Text>
        <Text className='profile-hero__body'>
          当前数据只保存在这台设备，不会上传到服务端。
        </Text>
      </View>

      {(snapshot.recoveredFromInvalid || snapshot.writeFailed) && (
        <View className='profile-notice'>
          {snapshot.writeFailed
            ? '部分本地数据暂时无法整理，请保持小程序开启。'
            : '部分旧数据无法读取，已安全整理。'}
        </View>
      )}

      <View className='profile-progress-card'>
        <View className='profile-progress-card__topline'>
          <Text className='profile-section-label'>
            {trainingContent.library?.title ?? '职场沟通基础'}
          </Text>
          <Text className='profile-progress-card__percent'>
            {summary.completionPercent}%
          </Text>
        </View>
        <Text className='profile-progress-card__title'>全课程学习进度</Text>
        <Text className='profile-progress-card__body'>
          已完成 {summary.completedCount}/{summary.availableCount} 组训练
        </Text>
        <View className='profile-progress-track'>
          <View
            className='profile-progress-track__value'
            style={{ width: `${summary.completionPercent}%` }}
          />
        </View>
      </View>

      <View className='profile-stats'>
        <View className='profile-stat'>
          <Text className='profile-stat__value'>{summary.currentStreak}</Text>
          <Text className='profile-stat__label'>连续天数</Text>
        </View>
        <View className='profile-stat'>
          <Text className='profile-stat__value'>{summary.weekEffectiveDayCount}/7</Text>
          <Text className='profile-stat__label'>本周学习</Text>
        </View>
        <View className='profile-stat'>
          <Text className='profile-stat__value'>{summary.dueReviewCount}</Text>
          <Text className='profile-stat__label'>到期复习</Text>
        </View>
        <View className='profile-stat'>
          <Text className='profile-stat__value'>{summary.favoriteCount}</Text>
          <Text className='profile-stat__label'>收藏原则</Text>
        </View>
      </View>

      <Text className='profile-section-title'>学习内容</Text>
      <View className='profile-link-list'>
        <Button className='microly-button profile-link' onClick={openPreferences}>
          <View className='profile-link__content'>
            <Text className='profile-link__title'>学习偏好</Text>
            <Text className='profile-link__body'>{snapshot.preferenceSummary}</Text>
          </View>
          <Text className='profile-link__meta'>›</Text>
        </Button>
        <Button className='microly-button profile-link' onClick={openCourse}>
          <View className='profile-link__content'>
            <Text className='profile-link__title'>课程进度</Text>
            <Text className='profile-link__body'>查看全部训练和完成状态</Text>
          </View>
          <Text className='profile-link__meta'>{summary.completedCount}/{summary.availableCount} ›</Text>
        </Button>
        <Button className='microly-button profile-link' onClick={openReviews}>
          <View className='profile-link__content'>
            <Text className='profile-link__title'>错题复习</Text>
            <Text className='profile-link__body'>
              {summary.dueReviewCount > 0
                ? `${summary.dueReviewCount} 题等待巩固`
                : snapshot.nextReviewAt
                  ? `${formatReviewDate(snapshot.nextReviewAt)}有下一次复习`
                  : '还没有安排复习'}
            </Text>
          </View>
          <Text className='profile-link__meta'>›</Text>
        </Button>
        <Button className='microly-button profile-link' onClick={openFavorites}>
          <View className='profile-link__content'>
            <Text className='profile-link__title'>收藏的原则</Text>
            <Text className='profile-link__body'>随时回看值得带走的表达结构</Text>
          </View>
          <Text className='profile-link__meta'>{summary.favoriteCount} ›</Text>
        </Button>
      </View>
    </View>
  )
}
