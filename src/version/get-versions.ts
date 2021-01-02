import {GraphQlQueryResponse} from '@octokit/graphql/dist-types/types'
import {Observable, from, throwError} from 'rxjs'
import {catchError, map} from 'rxjs/operators'
import {graphql} from './graphql'

export interface VersionInfo {
  id: string
  version: string
}

export interface GetVersionsQueryResponse {
  repository: {
    packages: {
      edges: {
        node: {
          name: string
          keepVersions: {
            edges: {node: VersionInfo}[]
          }
          lastVersions: {
            edges: {node: VersionInfo}[]
          }
        }
      }[]
    }
  }
}

const query = `
  query getVersions($owner: String!, $repo: String!, $package: String!, $last: Int!, $keep: Int!) {
    repository(owner: $owner, name: $repo) {
      packages(first: 1, names: [$package]) {
        edges {
          node {
            name
            keepVersions: versions(first: $keep) {
              edges {
                node {
                  id
                  version
                }
              }
            }
            lastVersions: versions(last: $last) {
              edges {
                node {
                  id
                  version
                }
              }
            }
          }
        }
      }
    }
  }`

export function queryForOldestVersions(
  owner: string,
  repo: string,
  packageName: string,
  numVersions: number,
  keepVersions: number,
  token: string
): Observable<GetVersionsQueryResponse> {
  return from(
    graphql(token, query, {
      owner,
      repo,
      package: packageName,
      last: numVersions,
      keep: keepVersions,
      headers: {
        Accept: 'application/vnd.github.packages-preview+json'
      }
    }) as Promise<GetVersionsQueryResponse>
  ).pipe(
    catchError((err: GraphQlQueryResponse) => {
      const msg = 'query for oldest version failed.'
      return throwError(
        err.errors && err.errors.length > 0
          ? `${msg} ${err.errors[0].message}`
          : `${msg} verify input parameters are correct`
      )
    })
  )
}

export function getOldestVersions(
  owner: string,
  repo: string,
  packageName: string,
  numVersions: number,
  keepVersions: number,
  token: string
): Observable<VersionInfo[]> {
  return queryForOldestVersions(
    owner,
    repo,
    packageName,
    numVersions,
    keepVersions,
    token
  ).pipe(
    map(result => {
      if (result.repository.packages.edges.length < 1) {
        throwError(
          `package: ${packageName} not found for owner: ${owner} in repo: ${repo}`
        )
      }

      const packages = result.repository.packages.edges
      return packages.reduce(
        (packageVersions: {id: string; version: string}[], singlePackage) => {
          const mapKeepVersions = singlePackage.node.keepVersions.edges.reduce(
            (mapVersionIds: Record<string, boolean>, version) => {
              mapVersionIds[version.node.id] = true

              return mapVersionIds
            },
            {}
          )
          console.log(
            `keeping the following versions [${keepVersions}): ${mapKeepVersions}`
          )
          const lastVersions = singlePackage.node.lastVersions.edges
            .filter(version => !mapKeepVersions[version.node.id])
            .map(version => ({
              id: version.node.id,
              version: version.node.version
            }))

          if (lastVersions.length !== numVersions) {
            console.log(
              `number of versions requested was: ${numVersions}, but found: ${lastVersions.length}`
            )
          }

          packageVersions.push(...lastVersions)

          return packageVersions
        },
        []
      )
    })
  )
}
