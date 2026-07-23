import { useEffect, useState } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { subscribeToContentUpdates } from '../../features/content/content-client'
import { formatReviewDate } from '../../features/review/review-state'
import { readProfileSnapshot } from '../../features/profile/profile-snapshot'
import { readAccountStatus, upgradeToWechat } from '../../features/account/account-service'

import './index.scss'

const MICROLY_MARK_IMAGE_URL = '/assets/brand/microly-mark.png'

export default function ProfilePage() {
  const [snapshot, setSnapshot] = useState(readProfileSnapshot)
  const [account, setAccount] = useState(readAccountStatus)
  const [loginBusy, setLoginBusy] = useState(false)

  useDidShow(() => {
    setSnapshot(readProfileSnapshot())
    setAccount(readAccountStatus())
  })
  useEffect(() => subscribeToContentUpdates(() => {
    setSnapshot(readProfileSnapshot())
  }), [])

  const { summary } = snapshot
  const openCourse = () => Taro.switchTab({ url: '/pages/course/index' })
  const openReviews = () => Taro.navigateTo({ url: '/pages/review/index' })
  const openFavorites = () => Taro.navigateTo({ url: '/pages/favorites/index' })
  const openPreferences = () => Taro.navigateTo({ url: '/pages/preferences/index' })
  const openSettings = () => Taro.navigateTo({ url: '/pages/settings/index' })
  const login = async () => {
    if (loginBusy) return
    setLoginBusy(true)
    try {
      const ok = await upgradeToWechat()
      if (!ok) {
        await Taro.showToast({ title: '登录未完成，请稍后重试', icon: 'none' })
        return
      }
      setAccount(readAccountStatus())
      setSnapshot(readProfileSnapshot())
      await Taro.showToast({ title: '登录成功，学习记录已同步', icon: 'success' })
    } catch {
      await Taro.showToast({ title: '登录未完成，请稍后重试', icon: 'none' })
    } finally {
      setLoginBusy(false)
    }
  }

  return (
    <View className='profile-page'>
      <View className='profile-hero'>
        <Text className='profile-hero__eyebrow'>我的学习</Text>
        <Text className='profile-hero__title'>{account.authType === 'wechat' ? '我的学习账号' : '本机学习记录'}</Text>
        <Text className='profile-hero__body'>
          {account.networkEnabled
            ? account.authType === 'wechat' ? '偏好、收藏、复习和学习进度已支持跨设备同步。' : '训练、复习和收藏都可以先在本机使用。'
            : '未配置联网服务，所有学习记录仅保存在本机。'}
        </Text>
      </View>

      {account.networkEnabled && account.authType !== 'wechat' && (
        <View className='profile-login-card'>
          <View className='profile-login-card__heading'>
            <View className='profile-login-card__badge'>
              <Image className='profile-login-card__badge-image' src={MICROLY_MARK_IMAGE_URL} mode='aspectFit' />
            </View>
            <View className='profile-login-card__copy'>
              <Text className='profile-login-card__title'>登录后，学习记录不丢失</Text>
              <Text className='profile-login-card__body'>同步进度、收藏与复习计划，可在其他设备继续学习。</Text>
            </View>
          </View>
          <Button
            className='microly-button profile-login-card__button'
            disabled={loginBusy}
            loading={loginBusy}
            onClick={login}
          >
            {loginBusy ? '正在登录…' : '微信登录并同步'}
          </Button>
          <Text className='profile-login-card__privacy'>不会读取头像、昵称或手机号 · 暂不登录也可继续使用</Text>
        </View>
      )}

      {(snapshot.recoveredFromInvalid || snapshot.writeFailed) && (
        <View className='profile-notice'>
          {snapshot.writeFailed
            ? '部分本地数据暂时无法整理，请保持小程序开启。'
            : '部分本地数据无法读取，已安全整理。'}
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
      <Text className='profile-section-title'>账号</Text>
      <View className='profile-link-list'>
        <Button className='microly-button profile-link' onClick={openSettings}>
          <View className='profile-link__content'>
            <Text className='profile-link__title'>账号与设置</Text>
            <Text className='profile-link__body'>{account.authType === 'wechat' ? '已登录微信 · 查看同步状态' : '同步设置、隐私与反馈'}</Text>
          </View>
          <Text className='profile-link__meta'>›</Text>
        </Button>
      </View>
    </View>
  )
}
