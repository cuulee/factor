import { deepMerge } from "@factor/api/utils"
import axios from "axios"
import cache from "memory-cache"
import { addEndpoint } from "@factor/api/endpoints"
import { FactorExtensionListing } from "../types"
import { extensions, ExtensionRecord } from "../extension-record"
import { endpointId } from "./util"
export const latestPackageVersion = async (name: string): Promise<string> => {
  const { data } = await axios.get(`https://data.jsdelivr.com/v1/package/npm/${name}`)

  if (data) {
    const {
      tags: { latest }
    } = data

    return latest
  } else return ""
}

export const getSingle = async (params: {
  name: string;
}): Promise<FactorExtensionListing> => {
  const { name } = params
  const cached = cache.get(name)
  if (cached) return cached

  const latest = await latestPackageVersion(name)

  const requests = [
    {
      _id: "npmData",
      url: `https://registry.npmjs.org/${name}`
    },
    {
      _id: "npmDownloads",
      url: `https://api.npmjs.org/downloads/point/last-month/${name}`
    },
    {
      _id: "npmFiles",
      url: `https://data.jsdelivr.com/v1/package/npm/${name}@${latest}`
    }
  ]

  // Run the requests, but add context for errors
  const results = await Promise.all(
    requests.map(async ({ _id, url }) => {
      try {
        return await axios.get(url)
      } catch (error) {
        error.message = `${_id} Request to ${url}: ${error.message}`
        throw new Error(error)
      }
    })
  )

  const parsed = results.map(result => result.data)

  const otherData = { cdnBaseUrl: `https://cdn.jsdelivr.net/npm/${name}@${latest}` }

  // Ensure array of objects and deep merge results
  const merged: any = deepMerge([params, otherData, ...parsed])

  const item = { ...merged, pkg: merged.versions[latest] }

  delete item.versions

  const FOUR_HOUR = 1000 * 60 * 60 * 4
  cache.put(name, item, FOUR_HOUR)

  return item
}

export const getIndex = async ({
  type = "plugins"
}): Promise<FactorExtensionListing[]> => {
  const extensionRecord: ExtensionRecord = extensions()
  const list = extensionRecord[type]

  return await Promise.all(list.map(async extension => getSingle(extension)))
}

addEndpoint({ id: endpointId, handler: { getIndex, getSingle } })
