import * as assert from "assert";
import { AxiosInstance, AxiosResponse } from "axios";
import { DeltaStorageService } from "../deltaStorageService";
import { TokenProvider } from "../token";

describe("DeltaStorageService", () => {
    /*
     * Use fake urls so we don't accidental make real calls that make our tests flakey.
     * Using microsoft.com as the domain so we don't send traffic somewhere hostile on accident.
     */
    const deltaStorageBasePath = "https://fake.microsoft.com";
    const deltaStorageRelativePath = "/drives/testdrive/items/testitem/opStream";
    // tslint:disable-next-line:mocha-no-side-effect-code
    const testDeltaStorageUrl = `${deltaStorageBasePath}${deltaStorageRelativePath}`;

    it("Should build the correct sharepoint delta url", () => {
        const deltaStorageService = new DeltaStorageService(testDeltaStorageUrl, undefined);
        const actualDeltaUrl = deltaStorageService.buildUrl(2, 8);
        // tslint:disable-next-line:max-line-length
        const expectedDeltaUrl = `${deltaStorageBasePath}/drives/testdrive/items/testitem/opStream?filter=sequenceNumber%20ge%203%20and%20sequenceNumber%20le%207`;
        assert.equal(actualDeltaUrl, expectedDeltaUrl, "The constructed delta url is invalid");
    });

    it("Should build the correct sharepoint delta url with auth", () => {
        const deltaStorageService = new DeltaStorageService(testDeltaStorageUrl, undefined);
        const actualDeltaUrl = deltaStorageService.buildUrl(2, 8, new TokenProvider("?access_token=123", ""));
        // tslint:disable-next-line:max-line-length
        const expectedDeltaUrl = `${deltaStorageBasePath}/drives/testdrive/items/testitem/opStream?filter=sequenceNumber%20ge%203%20and%20sequenceNumber%20le%207&access_token=123`;
        assert.equal(actualDeltaUrl, expectedDeltaUrl, "The constructed delta url is invalid");
    });

    describe("Get Returns Response With Op Envelope", () => {
        const expectedDeltaFeedResponse: any = {
            value: [
                {
                    op: {
                        clientId: "present-place",
                        clientSequenceNumber: 71,
                        contents: null,
                        minimumSequenceNumber: 1,
                        referenceSequenceNumber: 1,
                        sequenceNumber: 1,
                        text: "",
                        user: {
                            id: "Unruffled Bose",
                        },
                    },
                    sequenceNumber: 1,
                },
                {
                    op: {
                        clientId: "present-place",
                        clientSequenceNumber: 71,
                        contents: null,
                        minimumSequenceNumber: 1,
                        referenceSequenceNumber: 1,
                        sequenceNumber: 2,
                        type: "noop",
                        user: {
                            id: "Unruffled Bose",
                        },
                    },
                    sequenceNumber: 2,
                },
            ],
        };

        let deltaStorageService: DeltaStorageService;
        before(() => {
            const axiosMock: Partial<AxiosInstance> = {
                get: (url, config?) => new Promise<AxiosResponse>(
                    (resolve, reject) => {
                        const respone: AxiosResponse = {
                            config,
                            data: expectedDeltaFeedResponse,
                            headers: { "Access-Control-Allow-Origin": "*" },
                            request: "GET",
                            status: 200,
                            statusText: "OK",
                        };
                        resolve(respone);
                    }),
            };
            deltaStorageService = new DeltaStorageService(testDeltaStorageUrl, axiosMock as AxiosInstance);
        });

        it("Should deserialize the delta feed response correctly", async () => {
            const tokenProvider = new TokenProvider(null, null);
            const actualDeltaFeedResponse = await deltaStorageService.get(null, null, tokenProvider, 2, 8);
            assert.equal(actualDeltaFeedResponse.length, 2, "Deseralized feed response is not of expected length");
            assert.equal(actualDeltaFeedResponse[0].sequenceNumber, 1,
                "First element of feed response has invalid sequence number");
            assert.equal(actualDeltaFeedResponse[1].sequenceNumber, 2,
                "Second element of feed response has invalid sequence number");
            assert.equal(actualDeltaFeedResponse[1].type, "noop",
                "Second element of feed response has invalid op type");
        });
    });

    describe("Get Returns Response With Op Envelope", () => {
        const expectedDeltaFeedResponse: any = {
            value: [
                {
                    clientId: "present-place",
                    clientSequenceNumber: 71,
                    contents: null,
                    minimumSequenceNumber: 1,
                    referenceSequenceNumber: 1,
                    sequenceNumber: 1,
                    text: "",
                    user: {
                        id: "Unruffled Bose",
                    },
                },
                {
                    clientId: "present-place",
                    clientSequenceNumber: 71,
                    contents: null,
                    minimumSequenceNumber: 1,
                    referenceSequenceNumber: 1,
                    sequenceNumber: 2,
                    type: "noop",
                    user: {
                        id: "Unruffled Bose",
                    },
                },
            ],
        };

        let deltaStorageService: DeltaStorageService;
        before(() => {
            const axiosMock: Partial<AxiosInstance> = {
                get: (url, config?) => new Promise<AxiosResponse>(
                    (resolve, reject) => {
                        const respone: AxiosResponse = {
                            config,
                            data: expectedDeltaFeedResponse,
                            headers: { "Access-Control-Allow-Origin": "*" },
                            request: "GET",
                            status: 200,
                            statusText: "OK",
                        };
                        resolve(respone);
                    }),
            };
            deltaStorageService = new DeltaStorageService(testDeltaStorageUrl, axiosMock as AxiosInstance);
        });

        it("Should deserialize the delta feed response correctly", async () => {
            const tokenProvider = new TokenProvider(null, null);
            const actualDeltaFeedResponse = await deltaStorageService.get(null, null, tokenProvider, 2, 8);
            assert.equal(actualDeltaFeedResponse.length, 2, "Deseralized feed response is not of expected length");
            assert.equal(actualDeltaFeedResponse[0].sequenceNumber, 1,
                "First element of feed response has invalid sequence number");
            assert.equal(actualDeltaFeedResponse[1].sequenceNumber, 2,
                "Second element of feed response has invalid sequence number");
            assert.equal(actualDeltaFeedResponse[1].type, "noop",
                "Second element of feed response has invalid op type");
        });
    });
});
