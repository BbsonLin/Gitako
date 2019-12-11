import { ConfigsContextShape } from 'containers/ConfigsContext'
import { GetCreatedMethod, MethodCreator } from 'driver/connect'
import * as DOMHelper from 'utils/DOMHelper'
import * as GitHubHelper from 'utils/GitHubHelper'
import { MetaData, TreeData } from 'utils/GitHubHelper'
import * as URLHelper from 'utils/URLHelper'

export type Props = {
  configContext: ConfigsContextShape
}

export type ConnectorState = {
  // error message
  error?: string
  // whether Gitako side bar should be shown
  shouldShow: boolean
  // whether show settings pane
  showSettings: boolean
  // whether failed loading the repo due to it is private
  errorDueToAuth: boolean
  // meta data for the repository
  metaData?: MetaData
  // file tree data
  treeData?: TreeData
  logoContainerElement: Element | null
  disabled: boolean
  initializingPromise: Promise<void> | null
} & {
  init: GetCreatedMethod<typeof init>
  setMetaData: GetCreatedMethod<typeof setMetaData>
  setShouldShow: GetCreatedMethod<typeof setShouldShow>
  toggleShowSideBar: GetCreatedMethod<typeof toggleShowSideBar>
  toggleShowSettings: GetCreatedMethod<typeof toggleShowSettings>
} & {
  baseSize: number
}

type BoundMethodCreator<Args extends any[] = []> = MethodCreator<Props, ConnectorState, Args>

export const init: BoundMethodCreator = dispatch => async () => {
  const [{ initializingPromise }] = dispatch.get()
  if (initializingPromise) await initializingPromise

  let done: any = null // cannot use type `(() => void) | null` here
  dispatch.set({
    initializingPromise: new Promise(resolve => {
      done = () => resolve()
    }),
  })

  try {
    if (!URLHelper.isInRepoPage()) {
      dispatch.set({ disabled: true })
      return
    }
    DOMHelper.markGitakoReadyState(true)
    dispatch.set({
      errorDueToAuth: false,
      showSettings: false,
      logoContainerElement: DOMHelper.insertLogoMountPoint(),
    })
    let detectedBranchName
    const metaData = URLHelper.parse()
    if (DOMHelper.isInCodePage()) {
      detectedBranchName = DOMHelper.getCurrentBranch() || URLHelper.parseSHA() // not working well with non-branch blob // cannot handle '/' split branch name, should not use when possibly on branch page
    }
    metaData.branchName = detectedBranchName || 'master'
    dispatch.call(setMetaData, metaData)
    const [, { configContext }] = dispatch.get()
    const { sideBarWidth, access_token: accessToken, intelligentToggle } = configContext.val
    dispatch.set({
      baseSize: sideBarWidth,
    })

    if (!metaData.branchName || !metaData.userName) return
    const getTreeDataAggressively = GitHubHelper.getTreeData({
      branchName: metaData.branchName,
      userName: metaData.userName,
      repoName: metaData.repoName,
      accessToken,
    })
    const caughtAggressiveError = getTreeDataAggressively.catch(error => {
      // 1. the repo has no master branch
      // 2. detect branch name from DOM failed
      // 3. not very possible...
      // not handle this error immediately
      return error
    })
    let getTreeData = getTreeDataAggressively
    const metaDataFromAPI = await GitHubHelper.getRepoMeta({ ...metaData, accessToken })
    const projectDefaultBranchName = metaDataFromAPI['default_branch']
    if (!detectedBranchName && projectDefaultBranchName !== metaData.branchName) {
      // Accessing repository's non-homepage(no branch name in URL, nor in DOM)
      // We predicted its default branch to be 'master' and sent aggressive request
      // Throw that request due to the repo do not use {defaultBranchName} as default branch
      metaData.branchName = projectDefaultBranchName
      getTreeData = GitHubHelper.getTreeData({
        branchName: metaData.branchName,
        userName: metaData.userName,
        repoName: metaData.repoName,
        accessToken,
      })
    } else {
      caughtAggressiveError.then(error => {
        // aggressive requested correct branch but ends in failure (e.g. project is empty)
        if (error instanceof Error) {
          dispatch.call(handleError, error)
        }
      })
    }
    getTreeData
      .then(treeData => {
        if (treeData) {
          // in an unknown rare case this NOT happen
          dispatch.set({ treeData })
        }
      })
      .catch(err => dispatch.call(handleError, err))
    Object.assign(metaData, { api: metaDataFromAPI })
    dispatch.call(setMetaData, metaData)
    const shouldShow =
      intelligentToggle === null ? URLHelper.isInCodePage(metaData) : intelligentToggle
    dispatch.call(setShouldShow, shouldShow)
  } catch (err) {
    dispatch.call(handleError, err)
  } finally {
    if (done) done()
  }
}

export const handleError: BoundMethodCreator<[Error]> = dispatch => async err => {
  if (err.message === GitHubHelper.EMPTY_PROJECT) {
    dispatch.call(setError, 'This project seems to be empty.')
  } else if (err.message === GitHubHelper.BLOCKED_PROJECT) {
    dispatch.call(setError, 'This project is blocked.')
  } else if (
    err.message === GitHubHelper.NOT_FOUND ||
    err.message === GitHubHelper.BAD_CREDENTIALS ||
    err.message === GitHubHelper.API_RATE_LIMIT
  ) {
    dispatch.set({ errorDueToAuth: true })
    dispatch.call(setShowSettings, true)
  } else {
    DOMHelper.markGitakoReadyState(false)
    dispatch.call(setError, 'Gitako ate a bug, but it should recovery soon!')
    throw err
  }
}

export const toggleShowSideBar: BoundMethodCreator = dispatch => () => {
  const [{ shouldShow }, { configContext }] = dispatch.get()
  dispatch.call(setShouldShow, !shouldShow)

  const {
    val: { intelligentToggle },
  } = configContext
  if (intelligentToggle !== null) {
    configContext.set({ intelligentToggle: !shouldShow })
  }
}

export const setShouldShow: BoundMethodCreator<[
  ConnectorState['shouldShow'],
]> = dispatch => shouldShow => {
  dispatch.set({ shouldShow }, shouldShow ? DOMHelper.focusFileExplorer : undefined)
  DOMHelper.setBodyIndent(shouldShow)
}

export const setError: BoundMethodCreator<[ConnectorState['error']]> = dispatch => error => {
  dispatch.set({ error, disabled: true })
  dispatch.call(setShouldShow, false)
}

export const toggleShowSettings: BoundMethodCreator = dispatch => () =>
  dispatch.set(({ showSettings }) => ({
    showSettings: !showSettings,
  }))

export const setShowSettings: BoundMethodCreator<[
  ConnectorState['showSettings'],
]> = dispatch => showSettings => dispatch.set({ showSettings })

export const setMetaData: BoundMethodCreator<[ConnectorState['metaData']]> = dispatch => metaData =>
  dispatch.set({ metaData })
