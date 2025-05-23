import { Response, NextFunction } from 'express';
import { SolutionService, solutionService } from '../services/solution.service'; 
import { SolutionStatus, UserRole } from '../models/interfaces';
import { BaseController } from './BaseController';
import { AuthRequest } from '../types/request.types';
import { catchAsync } from '../utils/catch.async';
import { MongoSanitizer } from '../utils/mongo.sanitize';
import { logger } from '../utils/logger';
import { HTTP_STATUS } from '../constants';


/**
 * Controller for solution-related operations
 * Extends BaseController for standardized response handling
 * All business logic is delegated to the SolutionService
 */
export class SolutionController extends BaseController {
  private readonly solutionService: SolutionService;

  constructor() {
    super();
    this.solutionService = solutionService;
  }

  /**
   * Submit a solution to a challenge
   * @route POST /api/solutions
   * @access Private - Student only
   */
  public submitSolution = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has student role
      this.verifyAuthorization(req, [UserRole.STUDENT], 'submitting solutions');
      
      // Get the student profile ID using base controller method
      const studentId = await this.getUserProfileId(req, UserRole.STUDENT);
      
      // Extract and normalize challenge ID (support both field names)
      const { challenge, challengeId, title, description, submissionUrl, tags } = req.body;
      let effectiveChallengeId: string;
      
      try {
        // Prioritize challengeId if both are present, otherwise try challenge
        effectiveChallengeId = MongoSanitizer.validateObjectId(
          challengeId || challenge, 
          'challenge',
          {
            additionalContext: 'Please provide a valid challengeId in your request'
          }
        );
      } catch (error) {
        // Log the error with detailed context
        logger.warn(
          `Challenge ID validation failed during solution submission: ${error instanceof Error ? error.message : String(error)}`,
          { 
            userId: req.user?.userId,
            providedChallengeId: challengeId || challenge,
            requestBody: JSON.stringify(req.body) 
          }
        );
        throw error;
      }
      
      // Submit solution via service with validated IDs
      const solution = await this.solutionService.submitSolution(
        studentId,
        effectiveChallengeId,
        { title, description, submissionUrl, tags }
      );
      
      // Return success response
      this.sendSuccess(
        res,
        solution,
        'Solution submitted successfully',
        HTTP_STATUS.CREATED
      );
    }
  );

  /**
   * Get all solutions submitted by current student
   * @route GET /api/solutions/student
   * @access Private - Student only
   */
  public getStudentSolutions = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has student role
      this.verifyAuthorization(req, [UserRole.STUDENT]);
      
      // Get student profile ID
      const studentId = await this.getUserProfileId(req, UserRole.STUDENT);
      
      // Extract and parse query parameters
      const { status, page, limit, sortBy, sortOrder } = req.query;
      
      // Delegate to service for filtering and data retrieval
      const result = await this.solutionService.getStudentSolutions(
        studentId,
        {
          status: status as SolutionStatus,
          page: page ? parseInt(page as string) : undefined,
          limit: limit ? parseInt(limit as string) : undefined,
          sortBy: sortBy as string,
          sortOrder: sortOrder as 'asc' | 'desc'
        }
      );
      
      // Log action and send paginated response
      this.logAction('get-student-solutions', req.user!.userId, {
        count: result.solutions.length,
        status
      });

      this.sendPaginatedSuccess(
        res,
        {
          data: result.solutions,
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit),
          hasNextPage: result.page * result.limit < result.total,
          hasPrevPage: result.page > 1
        },
        'Student solutions retrieved successfully',
      );
    }
  );

  /**
   * Get all solutions for a specific challenge
   * @route GET /api/solutions/challenge/:challengeId
   * @access Private - Company (owner) or Architect or Admin
   */
  public getChallengeSolutions = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has appropriate role
      this.verifyAuthorization(req, [UserRole.COMPANY, UserRole.ARCHITECT, UserRole.ADMIN]);
      
      const { challengeId } = req.params;
      
      // Delegate to service which handles all authorization and business logic
      const result = await this.solutionService.getChallengeSolutions(
        challengeId,
        req.user!.userId,
        req.user!.role as UserRole
      );
      
      // Log action and send response
      this.logAction('get-challenge-solutions', req.user!.userId, {
        challengeId,
        count: result.solutions.length
      });

      this.sendPaginatedSuccess(
        res, 
        {
          data: result.solutions,
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit),
          hasNextPage: result.page * result.limit < result.total,
          hasPrevPage: result.page > 1
        }, 
        'Challenge solutions retrieved successfully',
      );
    }
  );

  /**
   * Get solution by ID
   * @route GET /api/solutions/:id
   * @access Private - Solution owner (Student) or Challenge owner (Company) or Architect or Admin
   */
  public getSolutionById = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // General authorization check
      this.verifyAuthorization(req);
      
      const { id } = req.params;
      
      // Delegate to service which handles all authorization logic
      const solution = await this.solutionService.getSolutionById(
        id, 
        req.user!.userId, 
        req.user!.role as UserRole
      );
      
      // Log action and send response
      this.logAction('get-solution', req.user!.userId, { solutionId: id });

      this.sendSuccess(res, solution, 'Solution retrieved successfully');
    }
  );

  /**
   * Update a solution (before deadline)
   * @route PUT /api/solutions/:id
   * @access Private - Solution owner (Student) only
   */
  public updateSolution = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has student role
      this.verifyAuthorization(req, [UserRole.STUDENT]);
      
      // Get student profile ID using base controller method
      const studentId = await this.getUserProfileId(req, UserRole.STUDENT);
      
      const { id } = req.params;
      const { title, description, submissionUrl } = req.body;
      
      // Delegate to service which handles all validation and business logic
      const updatedSolution = await this.solutionService.updateSolution(
        id,
        studentId,
        { title, description, submissionUrl }
      );
      
      // Log action and send response
      this.logAction('update-solution', req.user!.userId, { solutionId: id });

      this.sendSuccess(res, updatedSolution, 'Solution updated successfully');
    }
  );

  /**
   * Claim a solution for review
   * @route PATCH /api/solutions/:id/claim
   * @access Private - Architect only
   */
  public claimSolution = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has architect role
      this.verifyAuthorization(req, [UserRole.ARCHITECT]);
      
      // Get architect profile ID using base controller method
      const architectId = await this.getUserProfileId(req, UserRole.ARCHITECT);
      
      const { id } = req.params;
      
      // Delegate to service which handles all validation and business logic
      const updatedSolution = await this.solutionService.claimSolutionForReview(id, architectId);
      
      // Log action and send response
      this.logAction('claim-solution', req.user!.userId, { 
        solutionId: id,
        architectId
      });

      this.sendSuccess(res, updatedSolution, 'Solution claimed for review successfully');
    }
  );

  /**
   * Review a solution (approve/reject with feedback)
   * @route PATCH /api/solutions/:id/review
   * @access Private - Reviewing architect only
   */
  public reviewSolution = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has architect role
      this.verifyAuthorization(req, [UserRole.ARCHITECT]);
      
      // Get architect profile ID using base controller method
      const architectId = await this.getUserProfileId(req, UserRole.ARCHITECT);
      
      const { id } = req.params;
      const { status, feedback, score } = req.body;
      
      // Delegate validation and business logic to service layer
      const updatedSolution = await this.solutionService.reviewSolution(
        id, 
        architectId, 
        { status, feedback, score }
      );
      
      // Log action and send response
      this.logAction('review-solution', req.user!.userId, { 
        solutionId: id,
        status,
        architectId
      });

      this.sendSuccess(
        res, 
        updatedSolution, 
        `Solution ${status === SolutionStatus.APPROVED ? 'approved' : 'rejected'} successfully`
      );
    }
  );

  /**
   * Select a solution as a winner (by company)
   * @route PATCH /api/solutions/:id/select
   * @access Private - Company (challenge owner) only
   */
  public selectSolution = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has company role
      this.verifyAuthorization(req, [UserRole.COMPANY]);
      
      // Get company profile ID using base controller method
      const companyId = await this.getUserProfileId(req, UserRole.COMPANY);
      
      const { id } = req.params;
      const { companyFeedback, selectionReason } = req.body;
      
      // Delegate to service which handles all validation and business logic
      const updatedSolution = await this.solutionService.selectSolutionAsWinner(
        id, 
        companyId,
        { companyFeedback, selectionReason }
      );
      
      // Log action and send response
      this.logAction('select-solution', req.user!.userId, { 
        solutionId: id,
        companyId,
        hasFeedback: !!companyFeedback
      });

      this.sendSuccess(res, updatedSolution, 'Solution selected as winner successfully');
    }
  );

  /**
   * Get solutions reviewed by current architect
   * @route GET /api/solutions/architect
   * @access Private - Architect only
   */
  public getArchitectReviews = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      // Verify user has architect role
      this.verifyAuthorization(req, [UserRole.ARCHITECT]);
      
      // Get architect profile ID using base controller method
      const architectId = await this.getUserProfileId(req, UserRole.ARCHITECT);
      
      // Extract query parameters
      const { status, page, limit, sortBy, sortOrder } = req.query;
      
      // Delegate to service which handles all business logic
      const result = await this.solutionService.getArchitectReviews(
        architectId,
        {
          status: status as SolutionStatus,
          page: page ? parseInt(page as string) : undefined,
          limit: limit ? parseInt(limit as string) : undefined,
          sortBy: sortBy as string,
          sortOrder: sortOrder as 'asc' | 'desc'
        }
      );
      
      // Log action and send response
      this.logAction('get-architect-reviews', req.user!.userId, {
        count: result.data.length 
      });
  
      this.sendPaginatedSuccess(
        res, 
        {
          data: result.data, 
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit),
          hasNextPage: result.page * result.limit < result.total,
          hasPrevPage: result.page > 1
        },
        'Architect reviews retrieved successfully'
      );
    }
  );
}

// Export singleton instance for use in routes
export const solutionController = new SolutionController();