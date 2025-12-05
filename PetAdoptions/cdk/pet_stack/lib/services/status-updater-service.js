"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusUpdaterService = void 0;
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const nodejslambda = require("aws-cdk-lib/aws-lambda-nodejs");
const apigw = require("aws-cdk-lib/aws-apigateway");
const constructs_1 = require("constructs");
class StatusUpdaterService extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        var lambdaRole = new iam.Role(this, 'lambdaexecutionrole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'first', 'arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'second', 'arn:aws:iam::aws:policy/AWSLambda_FullAccess'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'fifth', 'arn:aws:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy'),
                iam.ManagedPolicy.fromManagedPolicyArn(this, 'lambdaBasicExecRole', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')
            ]
        });
        var layerArn = "arn:aws:lambda:" + process.env.CDK_DEFAULT_REGION + ":580247275435:layer:LambdaInsightsExtension:21";
        var layer = lambda.LayerVersion.fromLayerVersionArn(this, `LayerFromArn`, layerArn);
        const lambdaFunction = new nodejslambda.NodejsFunction(this, 'lambdafn', {
            runtime: lambda.Runtime.NODEJS_16_X, // execution environment
            entry: '../../petstatusupdater/index.js',
            depsLockFilePath: '../../petstatusupdater/package-lock.json',
            handler: 'handler',
            memorySize: 128,
            tracing: lambda.Tracing.ACTIVE,
            role: lambdaRole,
            layers: [layer],
            description: 'Update Pet availability status',
            environment: {
                "TABLE_NAME": props.tableName
            },
            bundling: {
                externalModules: [
                    'aws-sdk'
                ],
                nodeModules: [
                    'aws-xray-sdk'
                ]
            }
        });
        //defines an API Gateway REST API resource backed by our "petstatusupdater" function.
        this.api = new apigw.LambdaRestApi(this, 'PetAdoptionStatusUpdater', {
            handler: lambdaFunction,
            proxy: true,
            endpointConfiguration: {
                types: [apigw.EndpointType.REGIONAL]
            }, deployOptions: {
                tracingEnabled: true,
                loggingLevel: apigw.MethodLoggingLevel.INFO,
                stageName: 'prod'
            }, defaultMethodOptions: { methodResponses: [] }
            //defaultIntegration: new apigw.Integration({ integrationHttpMethod: 'PUT', type: apigw.IntegrationType.AWS })
        });
    }
}
exports.StatusUpdaterService = StatusUpdaterService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdHVzLXVwZGF0ZXItc2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInN0YXR1cy11cGRhdGVyLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQTJDO0FBQzNDLGlEQUFpRDtBQUNqRCw4REFBOEQ7QUFDOUQsb0RBQW9EO0FBQ3BELDJDQUFzQztBQU10QyxNQUFhLG9CQUFxQixTQUFRLHNCQUFTO0lBSWpELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBZ0M7UUFDeEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixJQUFJLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQ3pELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxlQUFlLEVBQUU7Z0JBQ2IsR0FBRyxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLGtEQUFrRCxDQUFDO2dCQUN6RyxHQUFHLENBQUMsYUFBYSxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsOENBQThDLENBQUM7Z0JBQ3RHLEdBQUcsQ0FBQyxhQUFhLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxxRUFBcUUsQ0FBQztnQkFDNUgsR0FBRyxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUUsa0VBQWtFLENBQUM7YUFDMUk7U0FDRixDQUFDLENBQUM7UUFFSCxJQUFJLFFBQVEsR0FBRyxpQkFBaUIsR0FBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixHQUFFLGdEQUFnRCxDQUFDO1FBQ25ILElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsbUJBQW1CLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUVwRixNQUFNLGNBQWMsR0FBRyxJQUFJLFlBQVksQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUNyRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUssd0JBQXdCO1lBQ2hFLEtBQUssRUFBRSxpQ0FBaUM7WUFDeEMsZ0JBQWdCLEVBQUUsMENBQTBDO1lBQzVELE9BQU8sRUFBRSxTQUFTO1lBQ2xCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTTtZQUM5QixJQUFJLEVBQUUsVUFBVTtZQUNoQixNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUM7WUFDZixXQUFXLEVBQUUsZ0NBQWdDO1lBQzdDLFdBQVcsRUFBRTtnQkFDVCxZQUFZLEVBQUUsS0FBSyxDQUFDLFNBQVM7YUFDaEM7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsZUFBZSxFQUFFO29CQUNmLFNBQVM7aUJBQ1Y7Z0JBQ0QsV0FBVyxFQUFFO29CQUNWLGNBQWM7aUJBQ2hCO2FBQ0Y7U0FDSixDQUFDLENBQUM7UUFFSCxxRkFBcUY7UUFDckYsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLEtBQUssQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2pFLE9BQU8sRUFBRSxjQUFjO1lBQ3ZCLEtBQUssRUFBRSxJQUFJO1lBQ1gscUJBQXFCLEVBQUU7Z0JBQ25CLEtBQUssRUFBRSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDO2FBQ3ZDLEVBQUUsYUFBYSxFQUFFO2dCQUNkLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixZQUFZLEVBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLElBQUk7Z0JBQzFDLFNBQVMsRUFBRSxNQUFNO2FBQ3BCLEVBQUUsb0JBQW9CLEVBQUUsRUFBQyxlQUFlLEVBQUUsRUFBRSxFQUFFO1lBQy9DLDhHQUE4RztTQUNqSCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF6REQsb0RBeURDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIG5vZGVqc2xhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XHJcbmltcG9ydCAqIGFzIGFwaWd3IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cydcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzVXBkYXRlclNlcnZpY2VQcm9wcyB7XHJcbiAgdGFibGVOYW1lOiBzdHJpbmdcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFN0YXR1c1VwZGF0ZXJTZXJ2aWNlIGV4dGVuZHMgQ29uc3RydWN0IHtcclxuXHJcbiAgcHVibGljIGFwaTogYXBpZ3cuUmVzdEFwaVxyXG5cclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU3RhdHVzVXBkYXRlclNlcnZpY2VQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcclxuXHJcbiAgICB2YXIgbGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnbGFtYmRhZXhlY3V0aW9ucm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ2ZpcnN0JywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0FtYXpvbkR5bmFtb0RCRnVsbEFjY2VzcycpLFxyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ3NlY29uZCcsICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BV1NMYW1iZGFfRnVsbEFjY2VzcycpLFxyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4odGhpcywgJ2ZpZnRoJywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0Nsb3VkV2F0Y2hMYW1iZGFJbnNpZ2h0c0V4ZWN1dGlvblJvbGVQb2xpY3knKSxcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKHRoaXMsICdsYW1iZGFCYXNpY0V4ZWNSb2xlJywgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxyXG4gICAgICBdXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgdmFyIGxheWVyQXJuID0gXCJhcm46YXdzOmxhbWJkYTpcIisgcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OICtcIjo1ODAyNDcyNzU0MzU6bGF5ZXI6TGFtYmRhSW5zaWdodHNFeHRlbnNpb246MjFcIjtcclxuICAgIHZhciBsYXllciA9IGxhbWJkYS5MYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybih0aGlzLCBgTGF5ZXJGcm9tQXJuYCwgbGF5ZXJBcm4pO1xyXG5cclxuICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uID0gbmV3IG5vZGVqc2xhbWJkYS5Ob2RlanNGdW5jdGlvbih0aGlzLCAnbGFtYmRhZm4nLCB7XHJcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE2X1gsICAgIC8vIGV4ZWN1dGlvbiBlbnZpcm9ubWVudFxyXG4gICAgICAgIGVudHJ5OiAnLi4vLi4vcGV0c3RhdHVzdXBkYXRlci9pbmRleC5qcycsXHJcbiAgICAgICAgZGVwc0xvY2tGaWxlUGF0aDogJy4uLy4uL3BldHN0YXR1c3VwZGF0ZXIvcGFja2FnZS1sb2NrLmpzb24nLFxyXG4gICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcclxuICAgICAgICBtZW1vcnlTaXplOiAxMjgsXHJcbiAgICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxyXG4gICAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXHJcbiAgICAgICAgbGF5ZXJzOiBbbGF5ZXJdLFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVXBkYXRlIFBldCBhdmFpbGFiaWxpdHkgc3RhdHVzJyxcclxuICAgICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgICAgICBcIlRBQkxFX05BTUVcIjogcHJvcHMudGFibGVOYW1lXHJcbiAgICAgICAgfSxcclxuICAgICAgICBidW5kbGluZzoge1xyXG4gICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXHJcbiAgICAgICAgICAgICdhd3Mtc2RrJ1xyXG4gICAgICAgICAgXSxcclxuICAgICAgICAgIG5vZGVNb2R1bGVzOiBbXHJcbiAgICAgICAgICAgICAnYXdzLXhyYXktc2RrJ1xyXG4gICAgICAgICAgXVxyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vZGVmaW5lcyBhbiBBUEkgR2F0ZXdheSBSRVNUIEFQSSByZXNvdXJjZSBiYWNrZWQgYnkgb3VyIFwicGV0c3RhdHVzdXBkYXRlclwiIGZ1bmN0aW9uLlxyXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ3cuTGFtYmRhUmVzdEFwaSh0aGlzLCAnUGV0QWRvcHRpb25TdGF0dXNVcGRhdGVyJywge1xyXG4gICAgICAgIGhhbmRsZXI6IGxhbWJkYUZ1bmN0aW9uLFxyXG4gICAgICAgIHByb3h5OiB0cnVlLFxyXG4gICAgICAgIGVuZHBvaW50Q29uZmlndXJhdGlvbjoge1xyXG4gICAgICAgICAgICB0eXBlczogW2FwaWd3LkVuZHBvaW50VHlwZS5SRUdJT05BTF1cclxuICAgICAgICB9LCBkZXBsb3lPcHRpb25zOiB7XHJcbiAgICAgICAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgICAgICBsb2dnaW5nTGV2ZWw6YXBpZ3cuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXHJcbiAgICAgICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnXHJcbiAgICAgICAgfSwgZGVmYXVsdE1ldGhvZE9wdGlvbnM6IHttZXRob2RSZXNwb25zZXM6IFtdIH1cclxuICAgICAgICAvL2RlZmF1bHRJbnRlZ3JhdGlvbjogbmV3IGFwaWd3LkludGVncmF0aW9uKHsgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiAnUFVUJywgdHlwZTogYXBpZ3cuSW50ZWdyYXRpb25UeXBlLkFXUyB9KVxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19